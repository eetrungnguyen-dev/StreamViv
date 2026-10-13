package com.devwolf75.streamviv

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var uvc: UvcBridge? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Runs before the first page load, so the page sees the bridge at startup.
  override fun onWebViewCreate(webView: WebView) {
    uvc?.destroy()
    uvc = UvcBridge(this, webView).also { webView.addJavascriptInterface(it, "StreamVivUVC") }
  }

  override fun onDestroy() {
    uvc?.destroy()
    uvc = null
    super.onDestroy()
  }
}
