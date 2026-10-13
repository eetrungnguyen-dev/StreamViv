import { writable, get } from "svelte/store";
import { AUTO, TOOLBAR_AUTO, TOOLBAR_PINNED } from "./constants.js";
import { FULL_FRAME, normalizeCrop } from "./crop.js";

/**
 * Persistent configuration.
 *
 * We deliberately use `localStorage` rather than the Tauri store plugin:
 * it is synchronous, needs no IPC round-trip, no extra Rust dependency and
 * no extra capability in `capabilities/default.json`. On a Surface Pro 3
 * that saves both binary size and a few ms of startup. The shape is
 * versioned so a future format change can migrate instead of exploding.
 */
const STORAGE_KEY = "ccv.settings.v2";

export const DEFAULTS = Object.freeze({
  // Devices are remembered by id *and* by label: USB capture sticks are
  // handed a fresh deviceId on almost every replug, but the label is
  // stable, so the label is what actually survives a reboot.
  videoDeviceId: "",
  videoDeviceLabel: "",
  audioDeviceId: "",
  audioDeviceLabel: "",

  resolution: AUTO, // key into RESOLUTIONS
  frameRate: AUTO, // key into FRAME_RATES
  rotation: 0, // 0 | 90 | 180 | 270
  fit: "contain", // contain | cover | stretch
  aspect: AUTO, // key into ASPECTS
  mirror: false,
  // The part of the frame to show, as fractions - see lib/crop.js.
  crop: FULL_FRAME,

  volume: 1,
  muted: false,

  // `resizeMode: "none"` forbids the browser from silently rescaling or
  // cropping the native frame. That keeps the capture path zero-copy,
  // which matters a lot on HD 4400 class graphics.
  nativeFrames: true,

  // auto | pinned | hidden - see TOOLBAR_MODES.
  toolbarMode: TOOLBAR_AUTO,
  showStats: false,
  decorations: true,
});

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
    // Only keep keys we know about, so stale fields cannot poison state.
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (parsed[key] !== undefined && typeof parsed[key] === typeof DEFAULTS[key]) {
        merged[key] = parsed[key];
      }
    }
    return migrate(merged, parsed);
  } catch (err) {
    console.warn("[settings] falling back to defaults:", err);
    return { ...DEFAULTS };
  }
}

/**
 * Carry forward settings written by an older build.
 *
 * The toolbar used to be a boolean `pinToolbar`; it now has three states,
 * and someone who had pinned it should not silently lose that on upgrade.
 * Unknown keys are already dropped by the loop above, so this is the only
 * place that gets to look at the raw stored object.
 */
function migrate(merged, parsed) {
  if (parsed.toolbarMode === undefined && typeof parsed.pinToolbar === "boolean") {
    merged.toolbarMode = parsed.pinToolbar ? TOOLBAR_PINNED : TOOLBAR_AUTO;
  }
  // The type check above only knows it is an object.
  merged.crop = normalizeCrop(merged.crop);
  return merged;
}

export const settings = writable(load());

// Writes are coalesced: rotating with the hotkey held down, or dragging the
// volume slider, must not hit localStorage (a synchronous, disk-backed API)
// on every frame.
let flushTimer = 0;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = 0;
    // Read the value at *flush* time, not at schedule time: several
    // changes can land inside one debounce window (hold R down, or drag
    // the volume slider) and only the latest one is worth writing.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get(settings)));
    } catch (err) {
      console.warn("[settings] persist failed:", err);
    }
  }, 250);
}

settings.subscribe(scheduleFlush);

/** Patch one or more fields. */
export function updateSettings(patch) {
  settings.update((s) => ({ ...s, ...patch }));
}

export function currentSettings() {
  return get(settings);
}

export function resetSettings() {
  settings.set({ ...DEFAULTS });
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Persist immediately - used on window unload. */
export function flushSettings() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get(settings)));
  } catch {
    /* ignore */
  }
}
