package com.example.moacalendar

import org.json.JSONObject
import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import java.util.Locale
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.moacalendar.data.MoaApiClient
import com.example.moacalendar.data.MoaRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val notificationsPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (filePathCallback != null) {
            val results = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(results)
            filePathCallback = null
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationsPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        val rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            // fitsSystemWindows = true ensures the window manager reserves space
            // for the status bar (top) and navigation bar / soft keys (bottom).
            fitsSystemWindows = true
            setBackgroundColor(android.graphics.Color.WHITE)
        }

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.WHITE)
        }

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                10
            )
            isIndeterminate = false
            max = 100
            visibility = View.GONE
        }

        rootLayout.addView(webView)
        rootLayout.addView(progressBar)
        setContentView(rootLayout)

        setupWebView()

        // Handle system back button inside WebView
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Initial sync of repository in background for widget
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                MoaRepository.getInstance(applicationContext).refreshAll()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.displayZoomControls = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // Provide a standard Chrome User-Agent without the WebView marker (wv) so Google/Kakao OAuth works seamlessly
        val defaultUa = settings.userAgentString
        val cleanUa = defaultUa.replace("; wv", "").replace("Version/4.0 ", "")
        settings.userAgentString = cleanUa

        // Add JavaScript interface for widget synchronization
        webView.addJavascriptInterface(MoaWebBridge(this, lifecycleScope), "MoaAndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                val uri = request.url

                // Handle intent:// schemes (e.g. Kakao talk app auth)
                if (url.startsWith("intent:")) {
                    try {
                        val parsedIntent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        if (parsedIntent != null) {
                            parsedIntent.addCategory(Intent.CATEGORY_BROWSABLE)
                            parsedIntent.component = null
                            parsedIntent.selector = null
                            if (parsedIntent.resolveActivity(packageManager) != null) {
                                startActivity(parsedIntent)
                                return true
                            }
                            val fallbackUrl = parsedIntent.getStringExtra("browser_fallback_url")
                            if (!fallbackUrl.isNullOrBlank()) {
                                val fallbackUri = Uri.parse(fallbackUrl)
                                if (fallbackUri.scheme == "market") {
                                    startActivity(Intent(Intent.ACTION_VIEW, fallbackUri))
                                    return true
                                }
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                }

                // Handle external apps (market, tel, mailto, etc.)
                val scheme = uri.scheme?.lowercase(Locale.ROOT)
                if (scheme != null && scheme != "http" && scheme != "https") {
                    if (scheme == "javascript" || scheme == "file" || scheme == "content" || scheme == "about") {
                        return true
                    }
                    try {
                        val externalIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                            addCategory(Intent.CATEGORY_BROWSABLE)
                            component = null
                            selector = null
                        }
                        startActivity(externalIntent)
                        return true
                    } catch (e: Exception) {
                        return true
                    }
                }

                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                cookieManager.flush()

                // Extract session cookie to keep MoaRepository & Home Widget in sync
                val cookies = cookieManager.getCookie("https://dwm.brightnetworks.kr")
                if (!cookies.isNullOrBlank()) {
                    val sessionToken = cookies.split(";")
                        .map { it.trim() }
                        .firstOrNull { it.startsWith("session=") }
                        ?.removePrefix("session=")

                    if (!sessionToken.isNullOrBlank()) {
                        val apiClient = MoaApiClient(this@MainActivity)
                        apiClient.sessionCookie = sessionToken
                        lifecycleScope.launch(Dispatchers.IO) {
                            try {
                                MoaRepository.getInstance(applicationContext).refreshAll()
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                        }
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress >= 100) {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }

                try {
                    fileChooserLauncher.launch(intent)
                    return true
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
            }
        }

        // Remediate Cross-App Scripting: Never load arbitrary/untrusted Intent data into WebView
        val targetUrl = sanitizeUrl(intent?.data?.toString())
        webView.loadUrl(targetUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Remediate Cross-App Scripting: Validate and sanitize URL before loading
        val rawUrl = intent.data?.toString()
        if (rawUrl != null && isTrustedUrl(rawUrl)) {
            val safeUrl = sanitizeUrl(rawUrl)
            val uri = Uri.parse(safeUrl)
            val action = uri.getQueryParameter("action") ?: ""
            val date = uri.getQueryParameter("date") ?: ""
            val eventId = uri.getQueryParameter("event_id") ?: ""

            if (action.isNotBlank() || date.isNotBlank() || eventId.isNotBlank()) {
                val escapedAction = JSONObject.quote(action)
                val escapedDate = JSONObject.quote(date)
                val escapedEventId = JSONObject.quote(eventId)
                val js = "if(typeof window.handleMoaWidgetAction==='function'){window.handleMoaWidgetAction($escapedAction,$escapedDate,$escapedEventId);}else{location.href='$safeUrl';}"
                webView.evaluateJavascript(js) { res ->
                    if (res == null || res == "null") {
                        webView.loadUrl(safeUrl)
                    }
                }
            } else {
                webView.loadUrl(safeUrl)
            }
        }
    }

    companion object {
        const val DEFAULT_URL = "https://dwm.brightnetworks.kr"
        private const val TRUSTED_HOST = "dwm.brightnetworks.kr"

        fun isTrustedUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            return try {
                val parsed = java.net.URI(rawUrl)
                val scheme = parsed.scheme?.lowercase(Locale.ROOT)
                val host = parsed.host?.lowercase(Locale.ROOT)

                // Strictly require https scheme (rejects javascript:, file:, content:, etc.)
                if (scheme != "https") {
                    return false
                }

                // Strictly require trusted host (rejects external hosts and subdomain tricks)
                if (host != TRUSTED_HOST) {
                    return false
                }

                // Reject user info (prevents credential abuse and URL confusion, e.g. https://dwm.brightnetworks.kr@evil.com)
                if (!parsed.userInfo.isNullOrBlank()) {
                    return false
                }

                // Reject non-standard ports
                if (parsed.port != -1 && parsed.port != 443) {
                    return false
                }

                true
            } catch (e: Exception) {
                false
            }
        }

        fun isTrustedUri(uri: Uri): Boolean {
            return isTrustedUrl(uri.toString())
        }

        fun sanitizeUrl(rawUrl: String?): String {
            if (!isTrustedUrl(rawUrl)) {
                return DEFAULT_URL
            }
            return try {
                val parsed = java.net.URI(rawUrl)
                val path = parsed.rawPath ?: ""
                val query = if (parsed.rawQuery != null) "?${parsed.rawQuery}" else ""
                val fragment = if (parsed.rawFragment != null) "#${parsed.rawFragment}" else ""
                "$DEFAULT_URL$path$query$fragment"
            } catch (e: Exception) {
                DEFAULT_URL
            }
        }

        fun sanitizeUrl(uri: Uri?): String {
            return sanitizeUrl(uri?.toString())
        }
    }
}
