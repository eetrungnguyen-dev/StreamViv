/**
 * Context menu bridge.
 *
 * Inside Tauri the menu is drawn by the OS: we hand the Rust side the item
 * list and it pops a real NSMenu / HMENU / GtkMenu at the pointer, then
 * emits back the id of whatever was chosen. In a plain browser there is no
 * such thing, so the caller falls back to the HTML menu component.
 *
 * Both paths are fed by `contextMenuItems()`, and every id is a hotkey
 * command name, so a click and a key press run the same handler.
 */

import { isTauri } from "./tauri.js";
import { contextMenuItems } from "./menu-items.js";

const EVENT = "context-menu-command";

let unlisten = null;

/**
 * Start forwarding native menu choices to `onCommand`.
 * Returns a teardown function; safe to call when not running under Tauri.
 */
export async function listenForMenuCommands(onCommand) {
  if (!isTauri) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    unlisten = await listen(EVENT, (event) => onCommand(event.payload));
  } catch (err) {
    console.warn("[menu] cannot listen for menu commands:", err);
    return () => {};
  }
  return () => {
    if (unlisten) unlisten();
    unlisten = null;
  };
}

/**
 * Ask the OS to show the menu.
 *
 * Resolves `false` when there is no native menu to show - in a browser, or
 * if the call fails for any reason - so the caller can fall back to the HTML
 * menu instead of leaving the user with no menu at all.
 *
 * @param {object} settings current settings
 * @returns {Promise<boolean>} whether the native menu was shown
 */
export async function showNativeContextMenu(settings) {
  if (!isTauri) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_context_menu", { items: contextMenuItems(settings) });
    return true;
  } catch (err) {
    console.warn("[menu] native menu unavailable, falling back to HTML:", err);
    return false;
  }
}
