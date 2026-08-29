/**
 * Thin, lazy wrapper around the Tauri window API.
 *
 * The module is imported dynamically so the app also runs as a plain web
 * page under `vite dev` (handy for testing the UI without a Rust
 * toolchain), and so the Tauri IPC glue is not parsed at startup when it
 * is not needed.
 */

import { IS_MAC } from "./platform.js";

export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

let windowPromise = null;

async function appWindow() {
  if (!isTauri) return null;
  if (!windowPromise) {
    windowPromise = import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow())
      .catch((err) => {
        console.warn("[tauri] window API unavailable:", err);
        return null;
      });
  }
  return windowPromise;
}

/**
 * macOS reports nothing useful for simple fullscreen - `isFullscreen()`
 * only knows about the native kind - so the state is tracked here.
 */
let macFullscreen = false;

/**
 * Borderless fullscreen. Inside Tauri we drive the native window, which is
 * a true borderless fullscreen with no browser chrome. In a plain browser
 * we fall back to the Fullscreen API so the same shortcut still works.
 *
 * macOS gets *simple* fullscreen: the pre-Lion kind that just resizes the
 * window over the whole screen. Native fullscreen would move the viewer to
 * a Space of its own, which animates on every toggle, breaks Cmd+Tab back
 * to whatever you are capturing, and leaves the menu bar to slide back in
 * whenever the pointer touches the top edge. Simple fullscreen covers the
 * menu bar and the Dock outright and stays in the current Space - which is
 * what you want from a picture you are watching next to something else.
 */
export async function setFullscreen(on) {
  const win = await appWindow();
  if (win) {
    if (IS_MAC) {
      await win.setSimpleFullscreen(on);
      macFullscreen = on;
      return on;
    }
    await win.setFullscreen(on);
    return on;
  }
  try {
    if (on && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else if (!on && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.warn("[fullscreen]", err);
  }
  return !!document.fullscreenElement;
}

export async function isFullscreen() {
  const win = await appWindow();
  if (win) {
    if (IS_MAC) return macFullscreen;
    try {
      return await win.isFullscreen();
    } catch {
      return false;
    }
  }
  return !!document.fullscreenElement;
}

export async function toggleFullscreen() {
  return setFullscreen(!(await isFullscreen()));
}

export async function setDecorations(on) {
  const win = await appWindow();
  if (win) {
    await win.setDecorations(on);
  }
  return on;
}
