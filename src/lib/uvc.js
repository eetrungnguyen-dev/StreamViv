/**
 * Android: USB capture cards through the native bridge (UvcBridge.kt).
 *
 * The Android System WebView only offers getUserMedia() the cameras the
 * phone's Camera2 HAL exposes, which on most phones excludes USB video
 * devices. So on Android the card is opened natively and drawn *behind* the
 * transparent page; this module wraps that in a MediaStream look-alike so
 * App.svelte and VideoStage keep a single code path.
 *
 * The bridge exists only inside the Android build (`window.StreamVivUVC`);
 * everywhere else NATIVE_UVC is false and nothing here runs.
 */

const bridge = typeof window !== "undefined" ? window.StreamVivUVC : undefined;
export const NATIVE_UVC = Boolean(bridge);

let nextId = 0;
const waiting = new Map();
let current = null;

if (bridge) {
  // The picture is behind the page, so the page must not paint over it.
  document.documentElement.classList.add("native-uvc");

  // Replies and events from Kotlin arrive here via evaluateJavascript().
  window.__streamvivUvc = (msg) => {
    if (msg.type === "result") {
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error));
      else w.resolve(msg.value);
    } else if (msg.type === "devicechange") {
      // App.svelte already listens for this on mediaDevices.
      navigator.mediaDevices?.dispatchEvent(new Event("devicechange"));
    } else if (msg.type === "ended") {
      current?.end();
    }
  };
}

/** Stands in for a MediaStreamTrack: stop(), getSettings() and "ended". */
class NativeTrack extends EventTarget {
  constructor(info) {
    super();
    this.kind = "video";
    this.label = info.label;
    this.readyState = "live";
    this.info = info;
  }

  getSettings() {
    const { deviceId, width, height, frameRate } = this.info;
    return { deviceId, width, height, frameRate };
  }

  stop() {
    if (this.readyState === "ended") return;
    this.readyState = "ended";
    if (current === this) {
      current = null;
      bridge.close();
    }
  }

  end() {
    this.readyState = "ended";
    if (current === this) current = null;
    this.dispatchEvent(new Event("ended"));
  }
}

/** @returns {{deviceId: string, label: string}[]} */
export function listUvcDevices() {
  return JSON.parse(bridge.devices());
}

/**
 * Open the card at the closest mode it offers. Shows the system USB
 * permission prompt the first time.
 */
export async function openUvcStream({ deviceId, width, height, fps }) {
  const id = ++nextId;
  const info = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    bridge.open(id, deviceId, width, height, fps);
  });
  const track = new NativeTrack(info);
  current = track;
  const stream = {
    native: true,
    width: info.width,
    height: info.height,
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  };
  return { stream, info };
}

/** Position the native picture; numbers are CSS px and get scaled here. */
export function layoutUvc({ x, y, w, h, rotation, sx, sy, crop }) {
  const k = window.devicePixelRatio || 1;
  bridge.layout(
    JSON.stringify({ x: x * k, y: y * k, w: Math.round(w * k), h: Math.round(h * k), rotation, sx, sy, crop })
  );
}
