/**
 * Touch gestures - the phone's stand-in for the keyboard shortcuts.
 *
 *   tap               show / hide the toolbar      (mouse move, T)
 *   double-tap        fullscreen                   (F, double-click)
 *   two-finger twist  rotate 90 either way         (R, Shift+R)
 *   pinch out / in    fill / fit                   (C)
 *   two-finger tap    stream info                  (I)
 *   long-press        the menu                     (right-click) - native
 *
 * Fed with pointer events from the stage; only `pointerType === "touch"`
 * is considered, so a mouse never triggers any of this.
 */

/** For the help card, in the same shape as hotkeys.js BINDINGS. */
export const GESTURES = [
  { keys: "Tap", action: "Show / hide the toolbar (also un-hides it)" },
  { keys: "Double-tap", action: "Fullscreen on / off" },
  { keys: "Two-finger twist", action: "Rotate 90 in the direction you turn" },
  { keys: "Pinch out / in", action: "Fill the screen / fit the whole picture" },
  { keys: "Two-finger tap", action: "Show stream info" },
  { keys: "Long-press", action: "Menu: crop, mirror, mute, reconnect ..." },
  { keys: "Back", action: "Close a menu or the crop editor, leave fullscreen" },
];

export const TAP_MS = 300; // longer than this is a press, not a tap
export const TAP_SLOP = 12; // px a finger may wander and still tap
export const DOUBLE_TAP_MS = 300;
export const TWIST_DEG = 35;
export const PINCH_OUT = 1.3;
export const PINCH_IN = 1 / 1.3;

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const angle = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/**
 * What two fingers are doing, from where they started to where they are.
 * Screen y points down, so a growing angle is a clockwise twist.
 * @returns {"rotate-cw"|"rotate-ccw"|"fill"|"fit"|null}
 */
export function classifyTwoFinger([a0, b0], [a1, b1]) {
  let turn = angle(a1, b1) - angle(a0, b0);
  turn = ((turn + 540) % 360) - 180; // shortest way round
  if (turn >= TWIST_DEG) return "rotate-cw";
  if (turn <= -TWIST_DEG) return "rotate-ccw";
  const d0 = dist(a0, b0);
  if (!d0) return null;
  const ratio = dist(a1, b1) / d0;
  if (ratio >= PINCH_OUT) return "fill";
  if (ratio <= PINCH_IN) return "fit";
  return null;
}

/**
 * @param {object} on handlers: tap(), doubleTap(), twoFingerTap(),
 *   twoFinger(kind) with kind from classifyTwoFinger
 * @param {() => number} [now]
 */
export function createGestures(on, now = () => performance.now()) {
  const fingers = new Map(); // pointerId -> {start, at}
  let startedAt = 0;
  let maxFingers = 0;
  let wandered = false;
  let fired = false; // a two-finger gesture already acted this touch
  let lastTap = null; // {t, x, y}
  let tapTimer = 0;

  function down(e) {
    if (e.pointerType !== "touch") return;
    if (!fingers.size) {
      startedAt = now();
      maxFingers = 0;
      wandered = false;
      fired = false;
    }
    fingers.set(e.pointerId, { start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY } });
    maxFingers = Math.max(maxFingers, fingers.size);
  }

  function move(e) {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    f.at = { x: e.clientX, y: e.clientY };
    if (dist(f.start, f.at) > TAP_SLOP) wandered = true;
    if (fingers.size === 2 && !fired) {
      const [p, q] = [...fingers.values()];
      const kind = classifyTwoFinger([p.start, q.start], [p.at, q.at]);
      if (kind) {
        fired = true; // one action per gesture, however far it goes
        on.twoFinger?.(kind);
      }
    }
  }

  function up(e) {
    if (!fingers.delete(e.pointerId) || fingers.size) return;
    // The last finger is up: was the whole touch a tap?
    const quick = now() - startedAt <= TAP_MS;
    if (fired || wandered || !quick) return;
    if (maxFingers === 2) {
      on.twoFingerTap?.();
      return;
    }
    if (maxFingers !== 1) return;
    const t = now();
    const p = { x: e.clientX, y: e.clientY };
    if (lastTap && t - lastTap.t <= DOUBLE_TAP_MS && dist(lastTap, p) <= 40) {
      clearTimeout(tapTimer);
      lastTap = null;
      on.doubleTap?.();
      return;
    }
    lastTap = { t, ...p };
    // A single tap waits out the double-tap window, so a double-tap does
    // not also flash the toolbar.
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      lastTap = null;
      on.tap?.();
    }, DOUBLE_TAP_MS);
  }

  function cancel(e) {
    fingers.delete(e.pointerId);
    wandered = true;
  }

  return { down, move, up, cancel };
}
