/**
 * Touch gesture recognition.
 * Run with:  bun test   (or: node --test test/)
 */
import { expect, test } from "./harness.js";
import { classifyTwoFinger, createGestures } from "../src/lib/gestures.js";

const P = (x, y) => ({ x, y });

test("a quarter twist clockwise rotates right, and back rotates left", () => {
  // Fingers on a horizontal line, then on a vertical one going down.
  expect(classifyTwoFinger([P(100, 200), P(300, 200)], [P(200, 100), P(200, 300)])).toBe("rotate-cw");
  expect(classifyTwoFinger([P(100, 200), P(300, 200)], [P(200, 300), P(200, 100)])).toBe("rotate-ccw");
});

test("twisting across the +-180 seam still reads as a small turn", () => {
  // From pointing left-and-slightly-up to left-and-slightly-down: ~20 degrees.
  const k = classifyTwoFinger([P(300, 200), P(100, 190)], [P(300, 200), P(100, 225)]);
  expect(k).toBe(null);
});

test("spreading fingers fills, pinching fits, a wobble does nothing", () => {
  expect(classifyTwoFinger([P(150, 200), P(250, 200)], [P(100, 200), P(300, 200)])).toBe("fill");
  expect(classifyTwoFinger([P(100, 200), P(300, 200)], [P(150, 200), P(250, 200)])).toBe("fit");
  expect(classifyTwoFinger([P(100, 200), P(300, 200)], [P(105, 202), P(295, 199)])).toBe(null);
});

// Drives createGestures with a fake clock; timers are real but short.
function rig() {
  let t = 0;
  const seen = [];
  const g = createGestures(
    {
      tap: () => seen.push("tap"),
      doubleTap: () => seen.push("double"),
      twoFingerTap: () => seen.push("two-tap"),
      twoFinger: (k) => seen.push(k),
    },
    () => t
  );
  const ev = (id, x, y, type = "touch") => ({ pointerId: id, clientX: x, clientY: y, pointerType: type });
  return { g, seen, ev, advance: (ms) => (t += ms) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("one quick tap shows the toolbar after the double-tap window", async () => {
  const { g, seen, ev, advance } = rig();
  g.down(ev(1, 50, 50));
  advance(80);
  g.up(ev(1, 52, 51));
  expect(seen).toEqual([]);
  await wait(350);
  expect(seen).toEqual(["tap"]);
});

test("two quick taps are a double-tap and nothing else", async () => {
  const { g, seen, ev, advance } = rig();
  g.down(ev(1, 50, 50));
  advance(60);
  g.up(ev(1, 50, 50));
  advance(120);
  g.down(ev(2, 55, 52));
  advance(60);
  g.up(ev(2, 55, 52));
  await wait(350);
  expect(seen).toEqual(["double"]);
});

test("a mouse never makes gestures", async () => {
  const { g, seen, ev, advance } = rig();
  g.down(ev(1, 50, 50, "mouse"));
  advance(50);
  g.up(ev(1, 50, 50, "mouse"));
  await wait(350);
  expect(seen).toEqual([]);
});

test("a twist fires once and is not also a tap", async () => {
  const { g, seen, ev, advance } = rig();
  g.down(ev(1, 100, 200));
  g.down(ev(2, 300, 200));
  g.move(ev(1, 200, 100));
  g.move(ev(2, 200, 300));
  g.move(ev(1, 300, 200)); // keeps turning: still one action
  advance(100);
  g.up(ev(1, 300, 200));
  g.up(ev(2, 100, 200));
  await wait(350);
  expect(seen).toEqual(["rotate-cw"]);
});

test("two fingers down and up together is a two-finger tap", () => {
  const { g, seen, ev, advance } = rig();
  g.down(ev(1, 100, 200));
  g.down(ev(2, 200, 200));
  advance(120);
  g.up(ev(1, 100, 200));
  g.up(ev(2, 200, 200));
  expect(seen).toEqual(["two-tap"]);
});

test("a slow press (long-press) is not a tap", async () => {
  const { g, seen, ev, advance } = rig();
  g.down(ev(1, 50, 50));
  advance(700);
  g.up(ev(1, 50, 50));
  await wait(350);
  expect(seen).toEqual([]);
});
