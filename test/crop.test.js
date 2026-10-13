/**
 * Crop region maths.
 * Run with:  bun test   (or: node --test test/)
 */
import { expect, test } from "./harness.js";
import {
  FULL_FRAME,
  MIN_SIDE,
  cropPixels,
  dragCrop,
  isFullFrame,
  normalizeCrop,
  resizeCropTo,
} from "../src/lib/crop.js";

const near = (a, b) => expect(Math.round(a * 1e6)).toBe(Math.round(b * 1e6));

test("malformed crops fall back to the full frame", () => {
  expect(normalizeCrop(null)).toEqual(FULL_FRAME);
  expect(normalizeCrop({ x: 0, y: 0, w: "1", h: 1 })).toEqual(FULL_FRAME);
  expect(isFullFrame(undefined)).toBe(true);
});

test("a crop is kept inside the frame", () => {
  const c = normalizeCrop({ x: 0.9, y: -0.2, w: 0.5, h: 2 });
  near(c.x, 0.5);
  near(c.y, 0);
  near(c.h, 1);
});

test("drawing a new box works in any direction", () => {
  const a = dragCrop(FULL_FRAME, "new", { x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 });
  const b = dragCrop(FULL_FRAME, "new", { x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 });
  for (const c of [a, b]) {
    near(c.x, 0.2);
    near(c.y, 0.3);
    near(c.w, 0.4);
    near(c.h, 0.4);
  }
});

test("a corner drag keeps the opposite corner fixed", () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  const c = dragCrop(start, "nw", { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.05 });
  near(c.x + c.w, 0.6);
  near(c.y + c.h, 0.6);
  near(c.x, 0.1);
  near(c.y, 0.05);
});

test("dragging a corner past its anchor flips instead of inverting", () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  const c = dragCrop(start, "se", { x: 0.6, y: 0.6 }, { x: 0.1, y: 0.1 });
  near(c.x, 0.1);
  near(c.w, 0.1);
  expect(c.w >= MIN_SIDE && c.h >= MIN_SIDE).toBe(true);
});

test("moving never leaves the frame", () => {
  const c = dragCrop({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, "move", { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.1 });
  near(c.x, 0.6);
  near(c.y, 0.1);
});

test("typing 800 x 600 on a 1080p frame keeps the centre", () => {
  const c = resizeCropTo(FULL_FRAME, 800, 600, 1920, 1080);
  expect(cropPixels(c, 1920, 1080)).toEqual({ width: 800, height: 600 });
  near(c.x + c.w / 2, 0.5);
  near(c.y + c.h / 2, 0.5);
});

test("an oversized typed size is capped to the frame", () => {
  const c = resizeCropTo({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 4000, 600, 1920, 1080);
  expect(cropPixels(c, 1920, 1080).width).toBe(1920);
  near(c.x, 0);
});
