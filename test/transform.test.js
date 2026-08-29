/**
 * Geometry checks for the rotation/fit maths.
 * Run with:  bun test   (or: node --test test/)
 */
import { expect, test } from "./harness.js";
import { computeTransform, nextRotation } from "../src/lib/transform.js";

const stage = { stageW: 1600, stageH: 900 };
const hd = { videoW: 1920, videoH: 1080 };

test("landscape source, no rotation, fills the window exactly", () => {
  const t = computeTransform({ ...stage, ...hd, rotation: 0 });
  expect(t.transform).toBe("translate(-50%, -50%) scale(1, 1)");
  expect(Math.round(t.contentW)).toBe(1600);
  expect(Math.round(t.contentH)).toBe(900);
});

test("90 degrees scales down to fit the window height, aspect preserved", () => {
  const t = computeTransform({ ...stage, ...hd, rotation: 90 });
  // 16:9 rotated into a 1600x900 window is limited by height.
  expect(Math.round(t.contentH)).toBe(900);
  expect(Math.round(t.contentW)).toBe(506);
  // aspect ratio of the rotated picture is 9:16
  expect(t.contentW / t.contentH).toBeCloseTo(9 / 16, 3);
  expect(t.transform).toContain("rotate(90deg)");
});

test("270 behaves like 90 but rotates the other way", () => {
  const a = computeTransform({ ...stage, ...hd, rotation: 90 });
  const b = computeTransform({ ...stage, ...hd, rotation: 270 });
  expect(b.contentW).toBeCloseTo(a.contentW, 5);
  expect(b.contentH).toBeCloseTo(a.contentH, 5);
  expect(b.transform).toContain("rotate(270deg)");
});

test("180 is a plain flip, never a rescale", () => {
  const t = computeTransform({ ...stage, ...hd, rotation: 180 });
  expect(t.transform).toBe("translate(-50%, -50%) rotate(180deg) scale(1, 1)");
});

test("portrait window with a 90-degree rotation fills the window", () => {
  const t = computeTransform({ stageW: 900, stageH: 1600, ...hd, rotation: 90 });
  // 9:16 picture in a 9:16 window: exact fit, no letterbox.
  expect(Math.round(t.contentW)).toBe(900);
  expect(Math.round(t.contentH)).toBe(1600);
});

test("cover crops instead of letterboxing", () => {
  const t = computeTransform({ ...stage, ...hd, rotation: 90, fit: "cover" });
  // Must cover both axes; the wider axis overflows.
  expect(t.contentW).toBeGreaterThanOrEqual(1600 - 0.01);
  expect(t.contentH).toBeGreaterThanOrEqual(900 - 0.01);
});

test("stretch fills exactly, in every orientation", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const t = computeTransform({ ...stage, ...hd, rotation, fit: "stretch" });
    expect(Math.round(t.contentW)).toBe(1600);
    expect(Math.round(t.contentH)).toBe(900);
  }
});

test("anamorphic override changes the displayed shape, not the fit", () => {
  const t = computeTransform({ ...stage, ...hd, aspect: 4 / 3 });
  expect(t.contentW / t.contentH).toBeCloseTo(4 / 3, 3);
  expect(t.contentW).toBeLessThanOrEqual(1600.01);
  expect(t.contentH).toBeLessThanOrEqual(900.01);
});

test("anamorphic override survives a quarter turn", () => {
  const t = computeTransform({ ...stage, ...hd, rotation: 90, aspect: 4 / 3 });
  expect(t.contentH / t.contentW).toBeCloseTo(4 / 3, 3);
  expect(t.contentH).toBeLessThanOrEqual(900.01);
});

test("mirror only flips X, keeping the same footprint", () => {
  const plain = computeTransform({ ...stage, ...hd, rotation: 90 });
  const flipped = computeTransform({ ...stage, ...hd, rotation: 90, mirror: true });
  expect(flipped.contentW).toBeCloseTo(plain.contentW, 5);
  expect(flipped.contentH).toBeCloseTo(plain.contentH, 5);
  expect(flipped.transform).toContain("scale(-");
});

test("no stream yet is a safe no-op", () => {
  const t = computeTransform({ stageW: 0, stageH: 0, videoW: 0, videoH: 0 });
  expect(t.transform).toBe("translate(-50%, -50%)");
});

test("rotation ring cycles forwards and backwards", () => {
  expect([0, 90, 180, 270].map((a) => nextRotation(a))).toEqual([90, 180, 270, 0]);
  expect(nextRotation(0, -90)).toBe(270);
  expect(nextRotation(90, -90)).toBe(0);
});
