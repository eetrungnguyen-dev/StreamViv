/**
 * Persistence behaviour. Run with:  bun test   (or: node --test test/)
 */
import { expect, test, beforeEach } from "./harness.js";

// Minimal localStorage stand-in, so the store can be tested outside a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const KEY = "ccv.settings.v2";
const { settings, updateSettings, flushSettings, resetSettings, DEFAULTS } = await import(
  "../src/lib/settings.js"
);

const read = () => JSON.parse(localStorage.getItem(KEY) || "null");

beforeEach(() => {
  store.clear();
  resetSettings();
});

test("defaults are sane for a fresh install", () => {
  expect(DEFAULTS.rotation).toBe(0);
  expect(DEFAULTS.fit).toBe("contain");
  expect(DEFAULTS.nativeFrames).toBe(true);
});

test("a burst of rapid changes persists the LAST value, not the first", async () => {
  // Regression guard: the debounce used to capture the value at schedule
  // time, so holding R down saved the first rotation and dropped the rest.
  updateSettings({ rotation: 90 });
  updateSettings({ rotation: 180 });
  updateSettings({ rotation: 270 });
  await new Promise((r) => setTimeout(r, 400));
  expect(read().rotation).toBe(270);
});

test("flushSettings writes immediately", () => {
  updateSettings({ rotation: 90, fit: "cover" });
  flushSettings();
  expect(read().rotation).toBe(90);
  expect(read().fit).toBe("cover");
});

test("unknown and wrongly-typed keys in storage are ignored", async () => {
  flushSettings();
  localStorage.setItem(
    KEY,
    JSON.stringify({ rotation: "ninety", bogus: 1, fit: "cover" })
  );
  // Re-import with a cache-busting query so the module re-reads storage.
  const fresh = await import("../src/lib/settings.js?reload");
  const value = fresh.currentSettings();
  expect(value.rotation).toBe(0); // wrong type -> default
  expect(value.fit).toBe("cover"); // right type -> kept
  expect(value.bogus).toBeUndefined(); // unknown -> dropped
});

test("a pinned toolbar survives the upgrade to three-state mode", async () => {
  // v2 stored a boolean. Someone who had pinned the toolbar must not have it
  // silently start fading out again after an update.
  localStorage.setItem(KEY, JSON.stringify({ pinToolbar: true }));
  const fresh = await import("../src/lib/settings.js?migrate1");
  expect(fresh.currentSettings().toolbarMode).toBe("pinned");
});

test("an unpinned toolbar upgrades to auto-hide, not to hidden", async () => {
  localStorage.setItem(KEY, JSON.stringify({ pinToolbar: false }));
  const fresh = await import("../src/lib/settings.js?migrate2");
  expect(fresh.currentSettings().toolbarMode).toBe("auto");
});

test("an explicit toolbarMode wins over the legacy boolean", async () => {
  localStorage.setItem(KEY, JSON.stringify({ pinToolbar: true, toolbarMode: "hidden" }));
  const fresh = await import("../src/lib/settings.js?migrate3");
  expect(fresh.currentSettings().toolbarMode).toBe("hidden");
});

test("corrupt storage falls back to defaults instead of throwing", async () => {
  localStorage.setItem(KEY, "{not json");
  const fresh = await import("../src/lib/settings.js?reload2");
  expect(fresh.currentSettings().rotation).toBe(0);
});
