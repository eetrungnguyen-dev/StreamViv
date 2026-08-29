/**
 * Keyboard shortcuts.
 *
 * Bindings are declared as data so the help overlay and the handler can
 * never drift apart, and both are parameterised by platform so macOS gets
 * Cmd where Windows and Linux get Ctrl.
 *
 * The rule for modified keys is deliberately narrow: we only claim the
 * combinations the webview would otherwise steal from us (reload, its own
 * fullscreen). Everything else - Cmd+Q, Cmd+W, Cmd+M, Alt+F4 - has to reach
 * the window manager untouched, because a viewer you cannot quit is a bug.
 */

import { MACOS, PLATFORM, modKey, modLabel } from "./platform.js";

/**
 * The shortcut table for one platform.
 * @param {string} [platform]
 */
export function bindingsFor(platform = PLATFORM) {
  const mod = modLabel(platform);
  const fullscreen =
    platform === MACOS
      ? `F  /  ${mod}+Ctrl+F  /  double-click`
      : "F  /  F11  /  double-click";
  return [
    { keys: `R  /  ${mod}+R`, action: "Rotate 90 clockwise (0 -> 90 -> 180 -> 270)" },
    { keys: "Shift+R", action: "Rotate 90 counter-clockwise" },
    { keys: fullscreen, action: "Borderless fullscreen" },
    { keys: "Esc", action: "Leave fullscreen" },
    { keys: "D", action: "Show / hide the title bar" },
    { keys: "T", action: "Toolbar: auto-hide / always on / hidden" },
    { keys: "I", action: "Show stream info" },
    { keys: "M", action: "Mute / unmute" },
    { keys: "C", action: "Cycle fit mode (fit / fill / stretch)" },
    { keys: "N", action: "Reconnect the capture device" },
    { keys: "?", action: "Toggle this help" },
  ];
}

/** Bindings for the platform this bundle is actually running on. */
export const BINDINGS = bindingsFor();

/**
 * Returns a command name for a keyboard event, or "" when the event is not
 * a shortcut. Typing into a <select> or <input> is never a shortcut.
 *
 * @param {KeyboardEvent} event
 * @param {string} [platform]
 */
export function matchBinding(event, platform = PLATFORM) {
  const target = event.target;
  if (target && typeof target === "object") {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable) {
      return "";
    }
  }

  const key = event.key;
  const usesMeta = modKey(platform) === "meta";
  // The "primary" modifier: Cmd on macOS, Ctrl on Windows and Linux.
  const mod = usesMeta ? event.metaKey : event.ctrlKey;
  // ...and the other one, which must never be part of an accidental match.
  const foreign = usesMeta ? event.ctrlKey : event.metaKey;

  // macOS drives native fullscreen with Cmd+Ctrl+F; that is the one
  // combination where both modifiers are legitimately held at once.
  if (usesMeta && event.metaKey && event.ctrlKey && !event.altKey) {
    return key === "f" || key === "F" ? "fullscreen" : "";
  }

  if (event.altKey) return "";

  if (mod) {
    // Reload (Ctrl+R / Cmd+R) would drop the stream and restart the app,
    // so it is claimed for rotation - the shortcut a user of a viewer
    // actually wants on that key. Every other Mod+key is left alone.
    if (foreign) return "";
    return key === "r" || key === "R" ? "rotate-cw" : "";
  }
  if (foreign) return "";

  // F11 is the Windows/Linux fullscreen key and the webview handles it
  // itself unless we swallow it first. On macOS it belongs to Mission
  // Control, but honouring it costs nothing if it ever arrives.
  if (key === "F11") return "fullscreen";

  switch (key) {
    case "r":
      return "rotate-cw";
    case "R":
      return "rotate-ccw";
    case "f":
    case "F":
      return "fullscreen";
    case "Escape":
      return "exit-fullscreen";
    case "t":
    case "T":
      return "cycle-toolbar";
    case "d":
    case "D":
      return "toggle-decorations";
    case "i":
    case "I":
      return "toggle-stats";
    case "m":
    case "M":
      return "toggle-mute";
    case "c":
    case "C":
      return "cycle-fit";
    case "n":
    case "N":
      return "reconnect";
    case "?":
      return "toggle-help";
    default:
      return "";
  }
}
