package com.example.moacalendar

import android.content.Context
import android.webkit.JavascriptInterface
import com.example.moacalendar.data.MoaRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MoaWebBridge(
    private val context: Context,
    private val scope: CoroutineScope
) {
    @JavascriptInterface
    fun syncWidget() {
        scope.launch(Dispatchers.IO) {
            try {
                MoaRepository.getInstance(context).refreshAll()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @JavascriptInterface
    fun syncEventsData(eventsJson: String?, calendarsJson: String?) {
        scope.launch(Dispatchers.IO) {
            try {
                MoaRepository.getInstance(context).updateFromWeb(eventsJson, calendarsJson)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
