/**
 * The constraint fallback ladder. Run with:  bun test   (or: node --test test/)
 */
import { expect, test } from "./harness.js";
import { buildVideoLadder, resolveDevice } from "../src/lib/capture.js";

const DEV = "dev-1";

test("auto/auto is a single request, not four", () => {
  const ladder = buildVideoLadder(DEV, "auto", "auto", true);
  expect(ladder.length).toBe(1);
  expect(ladder[0].constraints.width).toBeUndefined();
  expect(ladder[0].constraints.frameRate).toBeUndefined();
  expect(ladder[0].constraints.deviceId).toEqual({ exact: DEV });
});

test("resolution + fps degrades exact -> ideal fps -> ideal both -> default", () => {
  const ladder = buildVideoLadder(DEV, "1920x1080", "60", true);
  expect(ladder.length).toBe(4);

  expect(ladder[0].constraints.width).toEqual({ exact: 1920 });
  expect(ladder[0].constraints.frameRate).toEqual({ exact: 60 });

  expect(ladder[1].constraints.width).toEqual({ exact: 1920 });
  expect(ladder[1].constraints.frameRate).toEqual({ ideal: 60 });

  expect(ladder[2].constraints.width).toEqual({ ideal: 1920 });
  expect(ladder[2].constraints.frameRate).toEqual({ ideal: 60 });

  expect(ladder[3].constraints.width).toBeUndefined();
  expect(ladder[3].constraints.height).toBeUndefined();
});

test("4K resolution is requested exactly before falling back", () => {
  const ladder = buildVideoLadder(DEV, "3840x2160", "30", true);
  expect(ladder[0].constraints.width).toEqual({ exact: 3840 });
  expect(ladder[0].constraints.height).toEqual({ exact: 2160 });
});

test("every tier keeps the device pinned, so we never open the wrong card", () => {
  for (const tier of buildVideoLadder(DEV, "1280x720", "30", true)) {
    expect(tier.constraints.deviceId).toEqual({ exact: DEV });
  }
});

test("nativeFrames asks the browser not to rescale the captured frame", () => {
  expect(buildVideoLadder(DEV, "auto", "auto", true)[0].constraints.resizeMode).toEqual({
    ideal: "none",
  });
  expect(buildVideoLadder(DEV, "auto", "auto", false)[0].constraints.resizeMode).toBeUndefined();
});

test("resolution only, fps only", () => {
  const res = buildVideoLadder(DEV, "640x480", "auto", false);
  expect(res.map((t) => t.label)).toEqual([
    "exact resolution",
    "preferred resolution + fps",
    "card default",
  ]);

  const fps = buildVideoLadder(DEV, "auto", "24", false);
  expect(fps[0].constraints.frameRate).toEqual({ exact: 24 });
  expect(fps[0].constraints.width).toBeUndefined();
});

const LIST = [
  { deviceId: "aaa", groupId: "g1", label: "USB3.0 HD Video Capture" },
  { deviceId: "bbb", groupId: "g2", label: "Integrated Webcam" },
];

test("a remembered device is found by id", () => {
  expect(resolveDevice(LIST, "bbb", "anything")?.deviceId).toBe("bbb");
});

test("a replugged card keeps its label when its id has changed", () => {
  // This is the real-world case: Windows hands the card a brand new
  // deviceId after a replug, so the id lookup misses and the label saves us.
  expect(resolveDevice(LIST, "stale-id", "USB3.0 HD Video Capture")?.deviceId).toBe("aaa");
});

test("unknown device resolves to nothing rather than the wrong one", () => {
  expect(resolveDevice(LIST, "stale-id", "Elgato HD60")).toBe(null);
  expect(resolveDevice([], "aaa", "USB3.0 HD Video Capture")).toBe(null);
});
