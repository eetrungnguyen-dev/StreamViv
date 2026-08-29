// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod context_menu;
mod platform;

use tauri::Manager;

fn main() {
    platform::before_run();

    platform::configure_builder(tauri::Builder::default())
        .invoke_handler(tauri::generate_handler![context_menu::show_context_menu])
        // Both the app menu and the context menu arrive here; the context
        // menu's ids are hotkey command names, which the webview knows how
        // to run, so they are simply forwarded.
        .on_menu_event(context_menu::forward_menu_event)
        .setup(|app| {
            // The label matches `app.windows[0].label` in tauri.conf.json.
            match app.get_webview_window("main") {
                Some(window) => platform::on_window_ready(&window),
                None => eprintln!("[setup] no window labelled \"main\"; skipping webview setup"),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
