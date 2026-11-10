import AppKit
import WebKit

public final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var progressIndicator: NSProgressIndicator!
    private var topDragBar: WindowTopDragBar!
    private var observation: NSKeyValueObservation?

    public static let defaultServerURL = "https://dwm.brightnetworks.kr"
    private static let serverURLKey = "MoaCalendarServerURL"
    private let topDragBarHeight: CGFloat = 15.0 // Dedicated 15px dark green top bar for easy window dragging

    public static var currentServerURL: URL {
        get {
            if let saved = UserDefaults.standard.string(forKey: serverURLKey),
               let url = URL(string: saved), !saved.isEmpty {
                return url
            }
            return URL(string: defaultServerURL)!
        }
        set {
            UserDefaults.standard.set(newValue.absoluteString, forKey: serverURLKey)
        }
    }

    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 1140, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "모아 캘린더"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.backgroundColor = NSColor(calibratedRed: 248/255, green: 250/255, blue: 247/255, alpha: 1.0)
        window.minSize = NSSize(width: 720, height: 520)
        window.setFrameAutosaveName("MoaCalendarMainWindowFrame")

        super.init(window: window)
        window.delegate = self

        setupWebView()
        setupProgressBar()
        loadCurrentURL()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        observation?.invalidate()
    }

    private func setupWebView() {
        guard let window = self.window, let contentView = window.contentView else { return }

        // Enable CoreAnimation layer hosting on the window content view
        contentView.wantsLayer = true

        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.applicationNameForUserAgent = "MoaCalendarNative/1.0 (Macintosh; Intel Mac OS X)"

        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        // Native window drag handler injection
        let contentController = WKUserContentController()
        contentController.add(self, name: "windowDrag")

        let dragScriptSource = """
        (function() {
          function injectDragStyles() {
            if (document.getElementById('macos-native-drag-style')) return;
            const style = document.createElement('style');
            style.id = 'macos-native-drag-style';
            style.textContent = `
              .topbar, .calendar-title-group, .calendar-title, .sidebar-brand, .calendar-toolbar, .month-heading {
                -webkit-app-region: drag !important;
                user-select: none !important;
                -webkit-user-select: none !important;
              }
              button, a, input, select, textarea, [role="button"], [role="tab"], .topbar-actions, .icon, #mobile-search-trigger, #mobile-more-trigger, #share, .today-button, .view-btn, .month-nav, .dday-widget, .dday-widget-bar, .calendar-view-controls, #calendar, .month-grid, .weekdays {
                -webkit-app-region: no-drag !important;
              }
            `;
            (document.head || document.documentElement).appendChild(style);
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectDragStyles);
          } else {
            injectDragStyles();
          }

          document.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (e.target.closest('button, a, input, select, textarea, [role="button"], [role="tab"], .dday-widget, .dday-widget-bar, .icon, #today, .view-btn, .month-nav, #open-schedule-share-btn, .event-pill, .day, .week-col, dialog, .profile, #calendar, .month-grid, .weekdays')) {
              return;
            }
            if (e.target.closest('.topbar, .calendar-title-group, .calendar-heading-block, .sidebar-brand, #main-sidebar, .calendar-toolbar, .month-heading')) {
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.windowDrag) {
                window.webkit.messageHandlers.windowDrag.postMessage('drag');
              }
            }
          }, true);
        })();
        """
        let userScript = WKUserScript(source: dragScriptSource, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
        contentController.addUserScript(userScript)
        config.userContentController = contentController

        let bounds = contentView.bounds
        let webFrame = NSRect(x: 0, y: 0, width: bounds.width, height: bounds.height - topDragBarHeight)
        webView = WKWebView(frame: webFrame, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.wantsLayer = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.underPageBackgroundColor = NSColor(calibratedRed: 248/255, green: 250/255, blue: 247/255, alpha: 1.0)

        contentView.addSubview(webView)
        setupTopDragBar()
    }

    private func setupTopDragBar() {
        guard let window = self.window, let contentView = window.contentView else { return }
        let bounds = contentView.bounds
        let barFrame = NSRect(x: 0, y: bounds.height - topDragBarHeight, width: bounds.width, height: topDragBarHeight)
        topDragBar = WindowTopDragBar(frame: barFrame)
        topDragBar.autoresizingMask = [.width, .minYMargin]
        contentView.addSubview(topDragBar)
    }

    private func setupProgressBar() {
        guard let window = self.window, let contentView = window.contentView else { return }
        progressIndicator = NSProgressIndicator(frame: NSRect(x: 0, y: contentView.bounds.height - topDragBarHeight - 2, width: contentView.bounds.width, height: 2))
        progressIndicator.autoresizingMask = [.width, .minYMargin]
        progressIndicator.wantsLayer = true
        progressIndicator.isIndeterminate = false
        progressIndicator.minValue = 0.0
        progressIndicator.maxValue = 1.0
        progressIndicator.style = .bar
        progressIndicator.isHidden = true
        contentView.addSubview(progressIndicator)

        observation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard let self = self, let progress = change.newValue else { return }
            self.progressIndicator.doubleValue = progress
            if progress >= 1.0 {
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = 0.2
                    self.progressIndicator.animator().alphaValue = 0.0
                } completionHandler: {
                    self.progressIndicator.isHidden = true
                    self.progressIndicator.alphaValue = 1.0
                }
            } else {
                self.progressIndicator.isHidden = false
                self.progressIndicator.alphaValue = 1.0
            }
        }
    }

    public func loadCurrentURL() {
        let target = MainWindowController.currentServerURL
        let request = URLRequest(url: target, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        webView.load(request)
    }

    // MARK: - WKScriptMessageHandler

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "windowDrag" {
            if let currentEvent = NSApp.currentEvent {
                self.window?.performDrag(with: currentEvent)
            }
        }
    }

    // MARK: - Native Calendar Actions triggered by Menu / Shortcuts

    public func jumpToToday() {
        webView.evaluateJavaScript("document.getElementById('today')?.click();", completionHandler: nil)
    }

    public func createNewEvent() {
        webView.evaluateJavaScript("document.getElementById('new-event')?.click() || document.getElementById('mobile-day-add')?.click();", completionHandler: nil)
    }

    public func setViewMode(_ mode: String) {
        webView.evaluateJavaScript("document.querySelector('[data-view=\"\(mode)\"]')?.click();", completionHandler: nil)
    }

    public func navigateMonth(_ direction: String) {
        let btnId = direction == "prev" ? "prev" : "next"
        webView.evaluateJavaScript("document.getElementById('\(btnId)')?.click();", completionHandler: nil)
    }

    public func reloadPage() {
        webView.reload()
    }

    public func zoomIn() {
        webView.pageZoom += 0.1
    }

    public func zoomOut() {
        webView.pageZoom = max(0.5, webView.pageZoom - 0.1)
    }

    public func resetZoom() {
        webView.pageZoom = 1.0
    }

    public func goBack() {
        if webView.canGoBack {
            webView.goBack()
        }
    }

    public func goForward() {
        if webView.canGoForward {
            webView.goForward()
        }
    }

    // MARK: - Server URL Configuration Alert

    public func promptForServerURL() {
        let alert = NSAlert()
        alert.messageText = "서버 접속 주소 설정"
        alert.informativeText = "모아 캘린더 서버 URL을 입력하세요. (기본값: \(MainWindowController.defaultServerURL))"
        alert.alertStyle = .informational

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        input.stringValue = MainWindowController.currentServerURL.absoluteString
        alert.accessoryView = input

        alert.addButton(withTitle: "저장 및 접속")
        alert.addButton(withTitle: "기본값 복원")
        alert.addButton(withTitle: "취소")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            let text = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if let newURL = URL(string: text), newURL.scheme != nil {
                MainWindowController.currentServerURL = newURL
                loadCurrentURL()
            }
        } else if response == .alertSecondButtonReturn {
            MainWindowController.currentServerURL = URL(string: MainWindowController.defaultServerURL)!
            loadCurrentURL()
        }
    }

    // MARK: - NSWindowDelegate

    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    // MARK: - WKNavigationDelegate

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {}

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {}

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {}

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {}

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if let scheme = url.scheme, scheme != "http" && scheme != "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        if navigationAction.targetFrame == nil {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    // MARK: - WKUIDelegate

    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

// MARK: - Native Top Window Drag Bar (15px dark green bar)

final class WindowTopDragBar: NSView {
    public static let barColor = NSColor(calibratedRed: 42/255, green: 76/255, blue: 58/255, alpha: 1.0) // #2a4c3a: deep brand green

    override var mouseDownCanMoveWindow: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        self.wantsLayer = true
        self.layer?.backgroundColor = WindowTopDragBar.barColor.cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        self.wantsLayer = true
        self.layer?.backgroundColor = WindowTopDragBar.barColor.cgColor
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            window?.zoom(nil)
        } else {
            window?.performDrag(with: event)
        }
    }
}
