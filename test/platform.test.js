/**
 * Platform detection and the platform-dependent shortcuts.
 * Run with:  bun test   (or: node --test test/)
 *
 * Both units take the platform as an argument precisely so they can be
 * exercised for all three operating systems from one machine - the bug
 * these guard against (Cmd+R reloading the app on macOS and killing the
 * stream) is otherwise only reproducible on a Mac.
 */
import { expect, test } from "./harness.js";
import { detectPlatform, modKey, modLabel, LINUX, MACOS, WINDOWS, UNKNOWN } from "../src/lib/platform.js";
import { bindingsFor, matchBinding } from "../src/lib/hotkeys.js";
import { nextToolbarMode, toolbarModeByValue } from "../src/lib/constants.js";
import { contextMenuItems } from "../src/lib/menu-items.js";
import { readFileSync } from "node:fs";

// The commands App.svelte's runCommand() actually implements, read from the
// source so the list cannot rot as cases are added or renamed.
const HANDLED_COMMANDS = [
  ...readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8")
    .matchAll(/case "([a-z-]+)":/g),
].map((m) => m[1]);

const UA = {
  wkwebview: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  webkitgtk: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  webview2: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120",
};

test("each host webview is identified from its user agent", () => {
  expect(detectPlatform({ userAgent: UA.wkwebview })).toBe(MACOS);
  expect(detectPlatform({ userAgent: UA.webkitgtk })).toBe(LINUX);
  expect(detectPlatform({ userAgent: UA.webview2 })).toBe(WINDOWS);
});

test("userAgentData wins over the legacy strings when present", () => {
  const nav = { userAgentData: { platform: "Linux" }, userAgent: UA.webview2 };
  expect(detectPlatform(nav)).toBe(LINUX);
});

test("outside a browser the OS comes from process, not from a guess", () => {
  // Node's own navigator.userAgent is "Node.js/<version>" and says nothing
  // about the host, so it must not be read as Linux.
  const nav = { userAgent: "Node.js/26" };
  expect(detectPlatform(nav, { platform: "darwin" })).toBe(MACOS);
  expect(detectPlatform(nav, { platform: "linux" })).toBe(LINUX);
  expect(detectPlatform(nav, { platform: "win32" })).toBe(WINDOWS);
  expect(detectPlatform(nav, { platform: "aix" })).toBe(UNKNOWN);
});

test("the modifier is Cmd on macOS and Ctrl everywhere else", () => {
  expect(modKey(MACOS)).toBe("meta");
  expect(modLabel(MACOS)).toBe("Cmd");
  expect(modKey(LINUX)).toBe("ctrl");
  expect(modLabel(WINDOWS)).toBe("Ctrl");
});

/** Minimal KeyboardEvent stand-in. */
function key(k, mods = {}) {
  return {
    key: k,
    target: { tagName: "BODY" },
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  };
}

test("plain letter shortcuts are identical on every platform", () => {
  for (const platform of [MACOS, LINUX, WINDOWS]) {
    expect(matchBinding(key("r"), platform)).toBe("rotate-cw");
    expect(matchBinding(key("R"), platform)).toBe("rotate-ccw");
    expect(matchBinding(key("f"), platform)).toBe("fullscreen");
    expect(matchBinding(key("Escape"), platform)).toBe("exit-fullscreen");
    expect(matchBinding(key("?"), platform)).toBe("toggle-help");
  }
});

test("the reload shortcut is claimed for rotation on the right modifier", () => {
  // Cmd+R on macOS, Ctrl+R elsewhere: left unhandled it reloads the webview,
  // which drops the capture stream.
  expect(matchBinding(key("r", { metaKey: true }), MACOS)).toBe("rotate-cw");
  expect(matchBinding(key("r", { ctrlKey: true }), LINUX)).toBe("rotate-cw");
  expect(matchBinding(key("r", { ctrlKey: true }), WINDOWS)).toBe("rotate-cw");
});

test("the *other* platform's modifier never triggers anything", () => {
  // Ctrl+R on a Mac is not the reload shortcut, and Super+R on Linux
  // belongs to the window manager.
  expect(matchBinding(key("r", { ctrlKey: true }), MACOS)).toBe("");
  expect(matchBinding(key("r", { metaKey: true }), LINUX)).toBe("");
  expect(matchBinding(key("r", { metaKey: true }), WINDOWS)).toBe("");
});

test("window-management combinations are left to the OS", () => {
  // A viewer you cannot quit or close is a bug: these must fall through.
  for (const k of ["q", "w", "m", "h", "Tab"]) {
    expect(matchBinding(key(k, { metaKey: true }), MACOS)).toBe("");
    expect(matchBinding(key(k, { altKey: true }), LINUX)).toBe("");
  }
  expect(matchBinding(key("F4", { altKey: true }), WINDOWS)).toBe("");
});

test("macOS accepts its native fullscreen combination", () => {
  expect(matchBinding(key("f", { metaKey: true, ctrlKey: true }), MACOS)).toBe("fullscreen");
  // ...and nothing else claims both modifiers at once.
  expect(matchBinding(key("r", { metaKey: true, ctrlKey: true }), MACOS)).toBe("");
});

test("F11 still works where it is the fullscreen key", () => {
  expect(matchBinding(key("F11"), LINUX)).toBe("fullscreen");
  expect(matchBinding(key("F11"), WINDOWS)).toBe("fullscreen");
});

test("typing in a form control is never a shortcut", () => {
  for (const tag of ["INPUT", "SELECT", "TEXTAREA"]) {
    expect(matchBinding(key("f", { target: { tagName: tag } }), MACOS)).toBe("");
  }
});

test("T cycles the toolbar through all three states and back", () => {
  // The third state is the point: "hidden" has to be reachable, and has to
  // lead back round to "auto" rather than trapping the user there.
  expect(matchBinding(key("t"), MACOS)).toBe("cycle-toolbar");
  expect(nextToolbarMode("auto")).toBe("pinned");
  expect(nextToolbarMode("pinned")).toBe("hidden");
  expect(nextToolbarMode("hidden")).toBe("auto");
  // An unknown stored value must not strand the ring.
  expect(nextToolbarMode("nonsense")).toBe("pinned");
  expect(toolbarModeByValue("nonsense").value).toBe("auto");
});

test("the help overlay advertises the shortcut the platform actually uses", () => {
  const mac = bindingsFor(MACOS);
  const linux = bindingsFor(LINUX);
  expect(mac[0].keys).toContain("Cmd+R");
  expect(linux[0].keys).toContain("Ctrl+R");
  expect(mac[2].keys).toContain("Cmd+Ctrl+F");
  expect(linux[2].keys).toContain("F11");
  // The two tables have to stay the same shape, or the help drifts.
  expect(mac.length).toBe(linux.length);
});

/**
 * The keys muda's accelerator parser accepts as the final component. Taken
 * from its parse_code(): letters, digits and a handful of named/punctuation
 * keys. Notably absent: "?".
 */
const PARSEABLE_KEY = /^([A-Za-z]|[0-9]|F[0-9]{1,2}|Enter|Escape|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right|Comma|Period|Slash|Backslash|Minus|Equal|Semicolon|Quote|BracketLeft|BracketRight|Backquote|[,./\;'\[\]`=-])$/;
const MODIFIERS = /^(Shift|Control|Ctrl|Alt|Option|Super|Meta|Command|CmdOrCtrl)$/;

test("every native menu accelerator is one the parser will accept", () => {
  // A single unparseable accelerator makes the whole native menu fail to
  // build, and the frontend falls back to the HTML menu silently - so the
  // symptom is "the native menu was never implemented", not an error.
  const items = contextMenuItems({ fit: "contain", toolbarMode: "auto" });
  for (const item of items) {
    if (item.separator || !item.accelerator) continue;
    const parts = item.accelerator.split("+");
    const key = parts.pop();
    for (const mod of parts) {
      expect(MODIFIERS.test(mod)).toBe(true);
    }
    expect(PARSEABLE_KEY.test(key)).toBe(true);
  }
});

test("the touch menu names gestures, never keys, and drops the title bar", () => {
  const items = contextMenuItems({ fit: "contain", toolbarMode: "auto" }, true).filter((i) => !i.separator);
  expect(items.every((i) => !i.accelerator)).toBe(true);
  expect(items.some((i) => i.id === "toggle-decorations")).toBe(false);
  expect(items.find((i) => i.id === "fullscreen").hint).toBe("double-tap");
  for (const i of items) expect(HANDLED_COMMANDS.includes(i.id)).toBe(true);
});

test("every menu item id is a real command", () => {
  // Menu ids double as hotkey command names; a typo would produce an item
  // that opens the menu, closes it, and does nothing.
  const items = contextMenuItems({ fit: "contain", toolbarMode: "auto" });
  const ids = items.filter((i) => !i.separator).map((i) => i.id);
  expect(ids.length > 0).toBe(true);
  for (const id of ids) {
    expect(HANDLED_COMMANDS.includes(id)).toBe(true);
  }
});
