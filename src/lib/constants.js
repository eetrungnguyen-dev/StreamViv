/**
 * Static option tables. Kept out of components so the compiled Svelte
 * output stays small and these arrays are allocated exactly once.
 */

export const AUTO = "auto";

/** Rotation is stored as an angle, cycled through this ring. */
export const ROTATIONS = [0, 90, 180, 270];

/**
 * Resolution presets. `null` value means "let the card pick" (no width /
 * height constraint at all), which is the safest option for exotic USB
 * capture sticks that advertise garbage modes.
 */
export const RESOLUTIONS = [
  { label: "Auto (card default)", value: AUTO, width: 0, height: 0 },
  { label: "2560 x 1440  (2K QHD)", value: "2560x1440", width: 2560, height: 1440 },
  { label: "3840 x 2160  (4K UHD)", value: "3840x2160", width: 3840, height: 2160 },
  { label: "1920 x 1080  (1080p)", value: "1920x1080", width: 1920, height: 1080 },
  { label: "1600 x 900", value: "1600x900", width: 1600, height: 900 },
  { label: "1360 x 768", value: "1360x768", width: 1360, height: 768 },
  { label: "1280 x 720  (720p)", value: "1280x720", width: 1280, height: 720 },
  { label: "1024 x 768  (XGA 4:3)", value: "1024x768", width: 1024, height: 768 },
  { label: "960 x 540  (qHD)", value: "960x540", width: 960, height: 540 },
  { label: "800 x 600  (SVGA 4:3)", value: "800x600", width: 800, height: 600 },
  { label: "720 x 480  (480p)", value: "720x480", width: 720, height: 480 },
  { label: "640 x 480  (VGA 4:3)", value: "640x480", width: 640, height: 480 },
  { label: "480 x 270", value: "480x270", width: 480, height: 270 },
];

/** Frame rate presets, expressed as exact targets. */
export const FRAME_RATES = [
  { label: "Auto", value: AUTO, fps: 0 },
  { label: "60 fps", value: "60", fps: 60 },
  { label: "50 fps  (PAL)", value: "50", fps: 50 },
  { label: "30 fps", value: "30", fps: 30 },
  { label: "25 fps  (PAL)", value: "25", fps: 25 },
  { label: "24 fps  (cine)", value: "24", fps: 24 },
  { label: "15 fps  (low power)", value: "15", fps: 15 },
];

/**
 * How the picture is fitted into the window. `contain` never crops and
 * never stretches; `cover` fills the window and crops the overflow;
 * `stretch` distorts to fill. Matches the CSS object-fit vocabulary.
 */
export const FIT_MODES = [
  { label: "Fit (letterbox)", value: "contain" },
  { label: "Fill (crop)", value: "cover" },
  { label: "Stretch", value: "stretch" },
];

/**
 * Anamorphic correction. The upstream project stretched the video with a
 * raw `scaleX()`; we keep the same option list but treat it as "the source
 * pixels are not square, here is the real display aspect".
 */
export const ASPECTS = [
  { label: "Source (native)", value: AUTO, ratio: 0 },
  { label: "16:9", value: "16:9", ratio: 16 / 9 },
  { label: "16:10", value: "16:10", ratio: 16 / 10 },
  { label: "4:3", value: "4:3", ratio: 4 / 3 },
  { label: "1:1", value: "1:1", ratio: 1 },
  { label: "1.85:1", value: "1.85:1", ratio: 1.85 },
  { label: "2.35:1", value: "2.35:1", ratio: 2.35 },
  { label: "9:16 (vertical)", value: "9:16", ratio: 9 / 16 },
];

/**
 * Toolbar visibility. "auto" fades the toolbar out after IDLE_TIMEOUT_MS and
 * brings it back on any pointer movement; "pinned" keeps it up; "hidden"
 * keeps it down, including on movement, for watching something with nothing
 * at all on top of it.
 *
 * The way back from "hidden" is the T key or the right-click menu, and both
 * keep working - it is a display mode, not a lock.
 */
export const TOOLBAR_AUTO = "auto";
export const TOOLBAR_PINNED = "pinned";
export const TOOLBAR_HIDDEN = "hidden";

export const TOOLBAR_MODES = [
  { label: "Auto-hide", value: TOOLBAR_AUTO, hint: "fades after 3s of stillness" },
  { label: "Always on", value: TOOLBAR_PINNED, hint: "stays up" },
  { label: "Hidden", value: TOOLBAR_HIDDEN, hint: "never shown - T or right-click to bring it back" },
];

export function toolbarModeByValue(value) {
  return TOOLBAR_MODES.find((m) => m.value === value) || TOOLBAR_MODES[0];
}

/** Next mode in the auto -> always on -> hidden ring. */
export function nextToolbarMode(current) {
  // An unrecognised stored value is *displayed* as the first mode, so
  // stepping on from it has to behave as if it were that one. Letting
  // findIndex's -1 fall through would land back on the first mode and make
  // the first press of T look like a dead key.
  const i = TOOLBAR_MODES.findIndex((m) => m.value === current);
  const from = i === -1 ? 0 : i;
  return TOOLBAR_MODES[(from + 1) % TOOLBAR_MODES.length].value;
}

/** Milliseconds of pointer inactivity before the toolbar fades out. */
export const IDLE_TIMEOUT_MS = 3000;

export function resolutionByValue(value) {
  return RESOLUTIONS.find((r) => r.value === value) || RESOLUTIONS[0];
}

export function frameRateByValue(value) {
  return FRAME_RATES.find((f) => f.value === value) || FRAME_RATES[0];
}

export function aspectByValue(value) {
  return ASPECTS.find((a) => a.value === value) || ASPECTS[0];
}
