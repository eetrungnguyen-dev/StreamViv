/**
 * The context menu, defined once.
 *
 * There are two renderers - the native OS menu when running inside Tauri,
 * and an HTML fallback for `vite dev` in a browser - and the fastest way to
 * let two menus drift apart is to write the items down twice. So they are
 * written down here, and both renderers consume this.
 *
 * Every `id` is also a hotkey command name, so a menu click and a key press
 * land in exactly the same handler; adding an item cannot accidentally
 * introduce a second, subtly different code path for the same action.
 */

import { FIT_MODES, toolbarModeByValue } from "./constants.js";
import { isFullFrame } from "./crop.js";

/**
 * @param {object} s current settings
 * `accelerator` must be something the native parser accepts, or "" for none;
 * `hint` is what the HTML fallback shows when the two differ.
 *
 * @returns {Array<{id?: string, label?: string, accelerator?: string,
 *                  hint?: string, checked?: boolean, separator?: boolean}>}
 */
export function contextMenuItems(s, touch = false) {
  const fit = FIT_MODES.find((m) => m.value === s.fit) || FIT_MODES[0];
  const toolbar = toolbarModeByValue(s.toolbarMode);
  // On a phone the hint column names the gesture instead of the key
  // (lib/gestures.js); items without one show nothing rather than a key.
  const k = (key, gesture = "") => (touch ? { accelerator: "", hint: gesture } : { accelerator: key });

  return [
    { id: "rotate-cw", label: "Rotate right", ...k("R", "twist ↻") },
    { id: "rotate-ccw", label: "Rotate left", ...k("Shift+R", "twist ↺") },
    { id: "cycle-fit", label: `Fit: ${fit.label}`, ...k("C", "pinch") },
    { id: "toggle-mirror", label: "Mirror", accelerator: "", checked: s.mirror },
    { id: "edit-crop", label: "Crop…", ...k("X") },
    ...(isFullFrame(s.crop) ? [] : [{ id: "reset-crop", label: "Reset crop", accelerator: "" }]),
    { separator: true },
    { id: "fullscreen", label: "Fullscreen", ...k("F", "double-tap") },
    // A phone has no title bar to toggle.
    ...(touch ? [] : [{ id: "toggle-decorations", label: "Title bar", accelerator: "D", checked: s.decorations }]),
    { id: "toggle-mute", label: "Mute", ...k("M"), checked: s.muted },
    { id: "cycle-toolbar", label: `Toolbar: ${toolbar.label}`, ...k("T", "tap") },
    { separator: true },
    { id: "reconnect", label: "Reconnect device", ...k("N") },
    { id: "toggle-stats", label: "Stream info", ...k("I", "2-finger tap"), checked: s.showStats },
    // "?" is not a key name the native accelerator parser accepts, so it is
    // carried as a display hint and left off the native item.
    touch
      ? { id: "toggle-help", label: "Gestures", accelerator: "", hint: "" }
      : { id: "toggle-help", label: "Shortcuts", accelerator: "", hint: "?" },
  ];
}
