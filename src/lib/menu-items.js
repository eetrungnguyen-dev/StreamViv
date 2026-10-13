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
export function contextMenuItems(s) {
  const fit = FIT_MODES.find((m) => m.value === s.fit) || FIT_MODES[0];
  const toolbar = toolbarModeByValue(s.toolbarMode);

  return [
    { id: "rotate-cw", label: "Rotate right", accelerator: "R" },
    { id: "rotate-ccw", label: "Rotate left", accelerator: "Shift+R" },
    { id: "cycle-fit", label: `Fit: ${fit.label}`, accelerator: "C" },
    { id: "toggle-mirror", label: "Mirror", accelerator: "", checked: s.mirror },
    { id: "edit-crop", label: "Crop…", accelerator: "X" },
    ...(isFullFrame(s.crop) ? [] : [{ id: "reset-crop", label: "Reset crop", accelerator: "" }]),
    { separator: true },
    { id: "fullscreen", label: "Fullscreen", accelerator: "F" },
    { id: "toggle-decorations", label: "Title bar", accelerator: "D", checked: s.decorations },
    { id: "toggle-mute", label: "Mute", accelerator: "M", checked: s.muted },
    { id: "cycle-toolbar", label: `Toolbar: ${toolbar.label}`, accelerator: "T" },
    { separator: true },
    { id: "reconnect", label: "Reconnect device", accelerator: "N" },
    { id: "toggle-stats", label: "Stream info", accelerator: "I", checked: s.showStats },
    // "?" is not a key name the native accelerator parser accepts, so it is
    // carried as a display hint and left off the native item.
    { id: "toggle-help", label: "Shortcuts", accelerator: "", hint: "?" },
  ];
}
