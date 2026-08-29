//! The native context menu.
//!
//! The frontend owns *what* is in the menu - it is the side that knows the
//! current rotation, fit mode and mute state - and this module owns *how* it
//! is drawn. The webview sends a list of items on every right-click and gets
//! back the id of whatever was chosen, as an event.
//!
//! Drawing it natively rather than in HTML is the whole point: an NSMenu, an
//! HMENU and a GtkMenu come with keyboard navigation, type-ahead, the
//! platform's own styling, and the ability to extend past the edge of the
//! window - none of which an HTML menu gets without reimplementing it badly.
//! The item list is identical on all three, so the menu behaves the same
//! everywhere while looking native on each.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager, Window};

/// One entry, as sent by the frontend. A separator carries nothing else.
#[derive(Debug, Deserialize)]
pub struct ItemSpec {
    #[serde(default)]
    pub separator: bool,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub accelerator: String,
    /// Present only for items that are a toggle; `None` means "not a toggle",
    /// which is different from `Some(false)`.
    #[serde(default)]
    pub checked: Option<bool>,
}

/// Spelled out because a bare `None` cannot infer the string type here.
const NO_ACCEL: Option<&str> = None;

fn warn_accelerator(spec: &ItemSpec, err: &tauri::Error) {
    eprintln!(
        "[menu] ignoring unusable accelerator {:?} on \"{}\": {err}",
        spec.accelerator, spec.id
    );
}

/// The event the frontend listens for. The payload is the chosen item's id,
/// which is also a hotkey command name.
pub const MENU_EVENT: &str = "context-menu-command";

#[tauri::command]
pub fn show_context_menu(window: Window, items: Vec<ItemSpec>) -> Result<(), String> {
    let app = window.app_handle().clone();
    let mut built: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    for spec in &items {
        if spec.separator {
            built.push(Box::new(
                PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
            ));
            continue;
        }
        // An empty accelerator has to become None, not Some(""), which does
        // not parse.
        let accel = if spec.accelerator.is_empty() {
            None
        } else {
            Some(spec.accelerator.as_str())
        };

        // Accelerators are parsed, and the parser is picky - "?" is not a
        // key name it knows, for instance. A rejected accelerator must cost
        // that item its shortcut label and nothing more: failing the whole
        // call would leave the user with no menu at all, and because the
        // frontend falls back silently, it would look like the native menu
        // had never been implemented.
        let item: Box<dyn tauri::menu::IsMenuItem<tauri::Wry>> = match spec.checked {
            Some(checked) => {
                match CheckMenuItem::with_id(&app, &spec.id, &spec.label, true, checked, accel) {
                    Ok(item) => Box::new(item),
                    Err(err) => {
                        warn_accelerator(spec, &err);
                        Box::new(
                            CheckMenuItem::with_id(
                                &app, &spec.id, &spec.label, true, checked, NO_ACCEL,
                            )
                            .map_err(|e| e.to_string())?,
                        )
                    }
                }
            }
            None => match MenuItem::with_id(&app, &spec.id, &spec.label, true, accel) {
                Ok(item) => Box::new(item),
                Err(err) => {
                    warn_accelerator(spec, &err);
                    Box::new(
                        MenuItem::with_id(&app, &spec.id, &spec.label, true, NO_ACCEL)
                            .map_err(|e| e.to_string())?,
                    )
                }
            },
        };
        built.push(item);
    }

    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        built.iter().map(|b| b.as_ref()).collect();
    let menu = Menu::with_items(&app, &refs).map_err(|e| e.to_string())?;

    // popup() places the menu at the pointer, which is where a context menu
    // belongs and saves shipping coordinates across the IPC boundary.
    menu.popup(window).map_err(|e| e.to_string())
}

/// Forward a chosen item back to the webview.
pub fn forward_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.clone();
    if let Err(err) = app.emit(MENU_EVENT, id) {
        eprintln!("[menu] could not deliver the menu command: {err}");
    }
}
