/**
 * Host platform detection.
 *
 * The same bundle runs in three different webviews - WKWebView on macOS,
 * WebKitGTK on Linux, WebView2 on Windows - plus whatever browser you point
 * at `vite dev`. The differences that reach the UI are small but real:
 * the modifier key is Cmd on macOS and Ctrl everywhere else, and the
 * "your camera is blocked" remedy is a different settings panel on each OS.
 *
 * Detection happens once, at module load, and is exported as plain strings
 * and booleans so no hot path ever re-parses a user-agent string.
 */

export const MACOS = "macos";
export const LINUX = "linux";
export const WINDOWS = "windows";
export const UNKNOWN = "unknown";

/**
 * Resolve the host OS. The argument is injectable so this stays a pure
 * function under test; production callers use the module-level `PLATFORM`.
 *
 * `navigator.userAgentData.platform` is the only non-deprecated source, but
 * WKWebView and WebKitGTK do not implement it, so the UA string remains the
 * fallback. Outside a browser (unit tests, scripts) we ask Node.
 *
 * @param {object} [nav] navigator-like object
 * @param {object} [proc] process-like object
 * @returns {"macos"|"linux"|"windows"|"unknown"}
 */
export function detectPlatform(nav, proc) {
  const n = nav === undefined ? globalThis.navigator : nav;

  // Sources in order of trustworthiness. The Client Hints value is checked
  // on its own rather than concatenated with the rest, because a Chromium
  // user agent string always contains the *original* platform token too
  // ("Windows NT 10.0" even when userAgentData says Linux) and the longest
  // string would otherwise win the match.
  for (const source of [n && n.userAgentData && n.userAgentData.platform, n && n.platform, n && n.userAgent]) {
    const guess = classify(source);
    if (guess !== UNKNOWN) return guess;
  }

  // Not a browser: unit tests, build scripts, `node --test`.
  const p = proc === undefined ? globalThis.process : proc;
  switch (p && p.platform) {
    case "darwin":
      return MACOS;
    case "win32":
      return WINDOWS;
    case "linux":
    case "freebsd":
    case "openbsd":
    case "netbsd":
      return LINUX;
    default:
      return UNKNOWN;
  }
}

/**
 * Classify a single platform-ish string.
 *
 * "darwin" has to be tested before "win" or it matches as Windows, and
 * Node's own user agent ("Node.js/26") must not be mistaken for a browser.
 */
function classify(value) {
  if (!value || /node\.js/i.test(value)) return UNKNOWN;
  if (/mac|darwin|iphone|ipad/i.test(value)) return MACOS;
  if (/win/i.test(value)) return WINDOWS;
  if (/linux|x11|ubuntu|fedora|bsd|cros/i.test(value)) return LINUX;
  return UNKNOWN;
}

export const PLATFORM = detectPlatform();

export const IS_MAC = PLATFORM === MACOS;
export const IS_LINUX = PLATFORM === LINUX;
export const IS_WINDOWS = PLATFORM === WINDOWS;

/**
 * The key that plays the role Ctrl plays on Windows/Linux. Used both for
 * matching events and for rendering the help overlay, so the two can never
 * disagree.
 */
export function modKey(platform = PLATFORM) {
  return platform === MACOS ? "meta" : "ctrl";
}

/** Human-readable name of the modifier, for labels. */
export function modLabel(platform = PLATFORM) {
  return platform === MACOS ? "Cmd" : "Ctrl";
}

/** Short OS name, for the stream-info overlay. */
export function platformLabel(platform = PLATFORM) {
  switch (platform) {
    case MACOS:
      return "macOS";
    case LINUX:
      return "Linux";
    case WINDOWS:
      return "Windows";
    default:
      return "browser";
  }
}
