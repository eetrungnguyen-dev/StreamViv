package com.devwolf75.streamviv

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
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

    // Back is the phone's Esc: the page gets first say (close the crop
    // editor, a menu, help, leave fullscreen) and only an unhandled Back
    // falls through to wry's handler, which leaves the app. Registered after
    // wry's callback, so it runs first.
    val back = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.__streamvivBack ? window.__streamvivBack() : false") { handled ->
          if (handled != "true") {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    }
    onBackPressedDispatcher.addCallback(this, back)
  }

  override fun onDestroy() {
    uvc?.destroy()
    uvc = null
    super.onDestroy()
  }
}
