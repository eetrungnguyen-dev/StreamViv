/**
 * Crop region maths.
 *
 * A crop is the part of the captured frame that is shown, as fractions of
 * the frame: `{x, y, w, h}` in 0..1. Fractions rather than pixels so a crop
 * survives a resolution change (the same 4:3 area of a 720p and a 1080p
 * capture of the same source). Everything here is pure, for the tests.
 */

export const FULL_FRAME = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/** Smallest crop side, as a fraction - a handle has to stay grabbable. */
export const MIN_SIDE = 0.02;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A valid crop, or the full frame for anything malformed. */
export function normalizeCrop(c) {
  if (!c || typeof c !== "object") return FULL_FRAME;
  const nums = [c.x, c.y, c.w, c.h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return FULL_FRAME;
  const w = clamp(c.w, MIN_SIDE, 1);
  const h = clamp(c.h, MIN_SIDE, 1);
  return { x: clamp(c.x, 0, 1 - w), y: clamp(c.y, 0, 1 - h), w, h };
}

export function isFullFrame(c) {
  const n = normalizeCrop(c);
  return n.x < 1e-4 && n.y < 1e-4 && n.w > 1 - 1e-4 && n.h > 1 - 1e-4;
}

/** The crop's size in source pixels. */
export function cropPixels(c, frameW, frameH) {
  const n = normalizeCrop(c);
  return { width: Math.round(n.w * frameW), height: Math.round(n.h * frameH) };
}

/**
 * One drag step. `mode` is "move", "new" or a corner ("nw", "ne", "sw",
 * "se"); `from` and `to` are pointer positions in frame fractions, and
 * `start` is the crop when the drag began. "new" draws a fresh box from
 * `from`, so a tap outside the box starts over.
 */
export function dragCrop(start, mode, from, to) {
  const s = normalizeCrop(start);
  const px = clamp(to.x, 0, 1);
  const py = clamp(to.y, 0, 1);

  if (mode === "move") {
    return normalizeCrop({ ...s, x: s.x + (to.x - from.x), y: s.y + (to.y - from.y) });
  }

  // Every other mode keeps one corner fixed and moves the opposite one.
  let ax;
  let ay;
  if (mode === "new") {
    ax = clamp(from.x, 0, 1);
    ay = clamp(from.y, 0, 1);
  } else {
    ax = mode.includes("w") ? s.x + s.w : s.x;
    ay = mode.includes("n") ? s.y + s.h : s.y;
  }
  const x0 = Math.min(ax, px);
  const y0 = Math.min(ay, py);
  const w = Math.max(MIN_SIDE, Math.abs(px - ax));
  const h = Math.max(MIN_SIDE, Math.abs(py - ay));
  // Growing past MIN_SIDE from an anchor on the far edge must not push the
  // box off the frame, hence normalize (which clamps x/y) last.
  return normalizeCrop({ x: px < ax ? Math.min(x0, ax - w) : ax, y: py < ay ? Math.min(y0, ay - h) : ay, w, h });
}

/**
 * Resize to an exact pixel size about the current centre - the "type 800 x
 * 600" path. Sizes larger than the frame are capped to it.
 */
export function resizeCropTo(c, width, height, frameW, frameH) {
  const n = normalizeCrop(c);
  const w = clamp(width / frameW, MIN_SIDE, 1);
  const h = clamp(height / frameH, MIN_SIDE, 1);
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return normalizeCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}
