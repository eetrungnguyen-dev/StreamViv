//! Per-OS startup glue.
//!
//! Everything here exists because the three webviews Tauri wraps do not
//! agree on how a page is allowed to open a camera:
//!
//!   * **macOS / WKWebView** - wry already answers
//!     `requestMediaCapturePermissionForOrigin:` with `Grant`, so nothing
//!     has to happen at runtime. What macOS *does* require is a usage
//!     description in the binary's `__TEXT,__info_plist` section: touching
//!     the camera without one is not an error, it is an instant SIGKILL
//!     from TCC. `build.rs` embeds it.
//!   * **Linux / WebKitGTK** - the whole MediaStream API is hidden behind
//!     the `enable-media-stream` setting, which defaults to *off*, and even
//!     with it on every `getUserMedia()` and `enumerateDevices()` call
//!     raises a `permission-request` signal that is denied unless something
//!     handles it. Neither wry nor Tauri does, so we do it here. Without
//!     this the app builds and starts on Linux and then reports "no capture
//!     device" forever.
//!   * **Windows / WebView2** - grants camera access without being asked.
//!
//! Only the module for the target OS is compiled; the other two do not
//! exist in the binary.

/// Runs before the Tauri builder, while the process is still single
/// threaded (some of this touches the environment).
pub fn before_run() {
    imp::before_run();
}

/// Applies per-OS builder settings - currently the macOS menu bar.
pub fn configure_builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    imp::configure_builder(builder)
}

/// Runs once the main window and its webview exist.
pub fn on_window_ready(window: &tauri::WebviewWindow) {
    if let Err(err) = imp::on_window_ready(window) {
        eprintln!("[platform] could not configure the webview: {err}");
    }
}

#[cfg(target_os = "linux")]
mod imp {
    /// No menu bar is created on this platform, so there is nothing to trim.
    pub fn configure_builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder
    }

    use tauri::WebviewWindow;
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        WebViewExt,
    };

    pub fn before_run() {
        maybe_disable_dmabuf();
    }

    /// WebKitGTK 2.42+ renders through a DMA-BUF buffer that the proprietary
    /// NVIDIA driver on X11 cannot import, and the window comes up blank.
    /// The workaround costs performance, so it is applied only on the exact
    /// combination that needs it, and never over an explicit user setting.
    fn maybe_disable_dmabuf() {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
            return;
        }
        let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
        let x11 = std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11")
            || std::env::var_os("WAYLAND_DISPLAY").is_none();
        if nvidia && x11 {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    pub fn on_window_ready(window: &WebviewWindow) -> tauri::Result<()> {
        window.with_webview(|platform| {
            let webview = platform.inner();

            // Without this, `navigator.mediaDevices` is simply not defined.
            if let Some(settings) = WebViewExt::settings(&webview) {
                settings.set_enable_media_stream(true);
                settings.set_enable_media_capabilities(true);
                settings.set_enable_webrtc(true);
                settings.set_enable_webaudio(true);
            } else {
                eprintln!("[platform] WebKitGTK exposed no settings object; camera will not work");
            }

            // Two different requests reach this signal and both are needed:
            // `UserMedia` for getUserMedia(), and `DeviceInfo` for the
            // labelled device list the toolbar is built from. Anything else
            // (geolocation, notifications, media-plugin installation) is
            // left unhandled, which means WebKit denies it - the right
            // default for an offline video viewer.
            webview.connect_permission_request(|_, request| {
                let media = request.downcast_ref::<UserMediaPermissionRequest>().is_some();
                let device_info = request
                    .downcast_ref::<DeviceInfoPermissionRequest>()
                    .is_some();
                if media || device_info {
                    request.allow();
                    true
                } else {
                    false
                }
            });
        })
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
    use tauri::WebviewWindow;

    pub fn before_run() {}

    /// Replace the default macOS menu bar with a single application menu.
    ///
    /// Tauri installs a full File/Edit/View/Window/Help menu bar whenever an
    /// app does not define one of its own. For a viewer whose entire UI is a
    /// video surface and an auto-hiding toolbar, five of those six submenus
    /// are dead weight.
    ///
    /// They cannot simply be switched off, though: on macOS the keyboard
    /// shortcuts *are* the menu items, so `enable_macos_default_menu(false)`
    /// on its own would leave the app with no Cmd+Q, Cmd+H, Cmd+M or Cmd+W.
    /// So we keep exactly those, in the one submenu macOS always renders
    /// under the application name.
    ///
    /// This does not hide the system menu bar - nothing short of fullscreen
    /// does. `setSimpleFullscreen` in src/lib/tauri.js is what covers it.
    pub fn configure_builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder
            .enable_macos_default_menu(false)
            .menu(|handle| {
                let app_menu = Submenu::with_items(
                    handle,
                    "StreamViv",
                    true,
                    &[
                        &PredefinedMenuItem::hide(handle, None)?,
                        &PredefinedMenuItem::hide_others(handle, None)?,
                        &PredefinedMenuItem::show_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::minimize(handle, None)?,
                        &PredefinedMenuItem::close_window(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
                )?;
                Menu::with_items(handle, &[&app_menu])
            })
    }

    /// Nothing to do: wry's `WKUIDelegate` already grants media capture, and
    /// the TCC usage strings are baked into the binary by `build.rs`. The
    /// function is kept so `main.rs` stays free of `cfg` noise.
    pub fn on_window_ready(_window: &WebviewWindow) -> tauri::Result<()> {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod imp {
    /// No menu bar is created on this platform, so there is nothing to trim.
    pub fn configure_builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
        builder
    }

    use tauri::WebviewWindow;

    pub fn before_run() {}

    /// WebView2 allows camera and microphone access without a prompt.
    pub fn on_window_ready(_window: &WebviewWindow) -> tauri::Result<()> {
        Ok(())
    }
}
