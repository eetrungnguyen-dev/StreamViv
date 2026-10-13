import { AUTO, resolutionByValue, frameRateByValue } from "./constants.js";
import { LINUX, MACOS, PLATFORM, WINDOWS } from "./platform.js";
import { NATIVE_UVC, listUvcDevices, openUvcStream } from "./uvc.js";

/**
 * Everything that touches getUserMedia / enumerateDevices.
 *
 * Two things make USB capture cards different from webcams and drive the
 * design here:
 *   1. They lie. A card will happily advertise a mode and then fail
 *      `exact` constraints for it, so we need a fallback ladder rather
 *      than one all-or-nothing request.
 *   2. They get unplugged. deviceIds are regenerated on replug, so we
 *      re-match remembered devices by label.
 *
 * A third difference is not the card's fault: each host webview reaches the
 * camera through a different stack (AVFoundation on macOS, GStreamer/V4L2 on
 * Linux, Media Foundation on Windows) and fails in a different way, so every
 * error we surface is translated into the remedy for *this* OS.
 */

export class MediaError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "MediaError";
    this.cause = cause;
  }
}

/**
 * The one place that touches `navigator.mediaDevices`.
 *
 * It can legitimately be missing: WebKitGTK ships the whole MediaStream API
 * behind the `enable-media-stream` setting (off by default, and the Rust
 * side switches it on at startup), and some distribution builds of
 * WebKitGTK are compiled without media-stream support at all. Reaching
 * through an undefined `mediaDevices` would throw a bare TypeError, which
 * tells the user nothing, so we diagnose it once here instead.
 */
function mediaDevices() {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
  if (!md || typeof md.getUserMedia !== "function") {
    throw new MediaError(unsupportedMessage());
  }
  return md;
}

function unsupportedMessage(platform = PLATFORM) {
  if (platform === LINUX) {
    return (
      "This WebKitGTK build exposes no camera API (navigator.mediaDevices is missing). " +
      "Install the GStreamer plugins (gstreamer1.0-plugins-good, -plugins-base) and make sure " +
      "your WebKitGTK was built with media-stream support, then restart the app."
    );
  }
  return (
    "This webview exposes no camera API (navigator.mediaDevices is missing). " +
    "Open the app over http://localhost or as the packaged desktop build - a plain file:// page " +
    "is not a secure context and cannot use a capture device."
  );
}

/**
 * Ask once for permission so that `enumerateDevices` returns real labels.
 * Without this, every device is an anonymous empty string and the user
 * cannot tell their capture card from their webcam.
 */
export async function primePermissions() {
  let stream = null;
  if (NATIVE_UVC) {
    // Video is USB, asked for when the card is opened; asking for the
    // camera here would only prompt for the phone's own lenses.
    try {
      stream = await mediaDevices().getUserMedia({ audio: true });
    } catch {
      /* audio is optional */
    } finally {
      stopStream(stream);
    }
    return;
  }
  try {
    stream = await mediaDevices().getUserMedia({ video: true, audio: true });
  } catch (err) {
    // Audio-less machines (or a busy card) still deserve video labels.
    try {
      stream = await mediaDevices().getUserMedia({ video: true });
    } catch (err2) {
      if (err2 instanceof MediaError) throw err2;
      throw new MediaError(describeFailure(err2), err2);
    }
  } finally {
    stopStream(stream);
  }
}

export async function listDevices() {
  const devices = await mediaDevices().enumerateDevices();
  const video = NATIVE_UVC ? listUvcDevices() : [];
  const audio = [];
  for (const d of devices) {
    if (d.kind === "videoinput" && !NATIVE_UVC) video.push(plain(d));
    else if (d.kind === "audioinput") audio.push(plain(d));
  }
  return { video, audio };
}

function plain(d) {
  return {
    deviceId: d.deviceId,
    groupId: d.groupId,
    label: d.label || "Unnamed device",
  };
}

/**
 * Resolve a remembered device against the devices that actually exist now.
 * Exact id wins; a matching label is the fallback that survives a replug.
 */
export function resolveDevice(list, wantedId, wantedLabel) {
  if (!list.length) return null;
  if (wantedId) {
    const byId = list.find((d) => d.deviceId === wantedId);
    if (byId) return byId;
  }
  if (wantedLabel) {
    const byLabel = list.find((d) => d.label === wantedLabel);
    if (byLabel) return byLabel;
  }
  return null;
}

export function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already dead */
    }
  }
}

/**
 * Build the ladder of constraint sets, strictest first.
 *
 * Tier 0: exact device + exact resolution + exact fps  (what was asked for)
 * Tier 1: exact device + exact resolution + ideal fps  (card refused the fps)
 * Tier 2: exact device + ideal resolution + ideal fps  (card refused the mode)
 * Tier 3: exact device only                            (last resort)
 *
 * Tiers that would be identical to the previous one are skipped, so a fully
 * "Auto" request is a single getUserMedia call, not four.
 */
export function buildVideoLadder(deviceId, resolutionKey, frameRateKey, nativeFrames) {
  const res = resolutionByValue(resolutionKey);
  const rate = frameRateByValue(frameRateKey);
  const hasRes = res.value !== AUTO;
  const hasFps = rate.value !== AUTO;

  const base = () => {
    const c = {};
    if (deviceId) c.deviceId = { exact: deviceId };
    // `none` stops the browser from cropping/rescaling the native frame.
    if (nativeFrames) c.resizeMode = { ideal: "none" };
    return c;
  };

  const ladder = [];
  const push = (label, constraints) => ladder.push({ label, constraints });

  if (hasRes && hasFps) {
    push("exact resolution + exact fps", {
      ...base(),
      width: { exact: res.width },
      height: { exact: res.height },
      frameRate: { exact: rate.fps },
    });
    push("exact resolution + preferred fps", {
      ...base(),
      width: { exact: res.width },
      height: { exact: res.height },
      frameRate: { ideal: rate.fps },
    });
  } else if (hasRes) {
    push("exact resolution", {
      ...base(),
      width: { exact: res.width },
      height: { exact: res.height },
    });
  } else if (hasFps) {
    push("exact fps", { ...base(), frameRate: { exact: rate.fps } });
  }

  if (hasRes || hasFps) {
    const preferred = { ...base() };
    if (hasRes) {
      preferred.width = { ideal: res.width };
      preferred.height = { ideal: res.height };
    }
    if (hasFps) preferred.frameRate = { ideal: rate.fps };
    push("preferred resolution + fps", preferred);
  }

  push("card default", base());
  return ladder;
}

/**
 * Open a video stream, degrading through the ladder until something works.
 * Returns the stream plus a report of what was actually negotiated so the
 * UI can tell the user "you asked for 1080p60, you got 1080p30".
 */
export async function openVideoStream({ deviceId, resolution, frameRate, nativeFrames }) {
  if (NATIVE_UVC) {
    // The native side does its own fallback: the requested mode if the card
    // lists it, else its best MJPEG mode.
    const res = resolutionByValue(resolution);
    const rate = frameRateByValue(frameRate);
    try {
      const { stream, info } = await openUvcStream({
        deviceId,
        width: res.width,
        height: res.height,
        fps: rate.fps,
      });
      return {
        stream,
        applied: describeTrack(stream.getVideoTracks()[0]),
        tier: `USB ${info.format}`,
        degraded: info.degraded,
        attempts: [],
      };
    } catch (err) {
      throw new MediaError(err.message, err);
    }
  }
  const ladder = buildVideoLadder(deviceId, resolution, frameRate, nativeFrames);
  const attempts = [];
  let lastError = null;

  for (const tier of ladder) {
    try {
      const stream = await mediaDevices().getUserMedia({
        video: tier.constraints,
        audio: false,
      });
      return {
        stream,
        applied: describeTrack(stream.getVideoTracks()[0]),
        tier: tier.label,
        degraded: tier !== ladder[0],
        attempts,
      };
    } catch (err) {
      lastError = err;
      attempts.push({ tier: tier.label, error: errName(err) });
      // OverconstrainedError means "try something looser" - anything else
      // (NotAllowedError, NotFoundError, NotReadableError) will not be
      // fixed by loosening, so stop wasting time on the remaining tiers.
      if (!isOverconstrained(err)) break;
    }
  }

  throw new MediaError(describeFailure(lastError), lastError);
}

export async function openAudioStream({ deviceId }) {
  // Capture-card audio is line-level program audio, not a voice call:
  // every piece of "helpful" DSP has to be switched off or it will pump,
  // gate and mangle game audio.
  const constraints = {
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  const stream = await mediaDevices().getUserMedia({ audio: constraints, video: false });
  return { stream, applied: describeTrack(stream.getAudioTracks()[0]) };
}

function describeTrack(track) {
  if (!track) return null;
  const s = typeof track.getSettings === "function" ? track.getSettings() : {};
  return {
    label: track.label,
    deviceId: s.deviceId || "",
    width: s.width || 0,
    height: s.height || 0,
    frameRate: s.frameRate ? Math.round(s.frameRate * 100) / 100 : 0,
    sampleRate: s.sampleRate || 0,
    resizeMode: s.resizeMode || "",
  };
}

function isOverconstrained(err) {
  return errName(err) === "OverconstrainedError";
}

function errName(err) {
  return (err && (err.name || err.constructor?.name)) || "Error";
}

export function describeFailure(err, platform = PLATFORM) {
  switch (errName(err)) {
    case "NotAllowedError":
      return `Access to the capture device was blocked. ${grantHint(platform)}`;
    case "NotFoundError":
      return `No matching capture device found. ${presenceHint(platform)}`;
    case "NotReadableError":
      return `The capture device is busy or the driver refused it. ${busyHint(platform)}`;
    case "OverconstrainedError":
      return "The card rejected every resolution/frame-rate combination that was tried. Set Resolution and FPS back to Auto.";
    default:
      return `Could not open the capture device: ${(err && err.message) || err}`;
  }
}

/** Where this OS hides the "yes, this app may use the camera" switch. */
function grantHint(platform) {
  switch (platform) {
    case MACOS:
      return (
        "macOS asks once, per app. Open System Settings > Privacy & Security > Camera " +
        "(and Microphone), enable StreamViv, then quit and reopen the app - " +
        "the permission is only re-read at launch."
      );
    case WINDOWS:
      return "Open Settings > Privacy & security > Camera and allow desktop apps to access it, then press Reconnect.";
    case LINUX:
      return (
        "The webview denied the request. If you are running the packaged app, check that no " +
        "portal/permission prompt was dismissed; in a browser, allow camera access for this page."
      );
    default:
      return "Allow camera and microphone access, then press Reconnect.";
  }
}

/** How to check the device is actually there. */
function presenceHint(platform) {
  switch (platform) {
    case LINUX:
      return (
        "Check that the card shows up as /dev/video* (`v4l2-ctl --list-devices`) and that your " +
        "user is in the `video` group - a fresh install often is not."
      );
    case MACOS:
      return "Check the card appears under Apple menu > About This Mac > More Info > USB, then press Reconnect.";
    default:
      return "Check that the card is plugged in, then press Reconnect.";
  }
}

/** Who is likely holding the device hostage. */
function busyHint(platform) {
  switch (platform) {
    case LINUX:
      return "Find the holder with `fuser -v /dev/video0` and close it (OBS, Cheese, another viewer), then press Reconnect.";
    case MACOS:
      return "Quit anything else using the card (QuickTime, OBS, FaceTime, Photo Booth), then press Reconnect.";
    default:
      return "Close OBS or any other app holding the card, then press Reconnect.";
  }
}
