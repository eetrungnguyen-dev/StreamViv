/**
 * Rotation / fit geometry.
 *
 * The whole point of this module is that the <video> element itself never
 * changes size: it is pinned to the stage box, and every visual change is
 * expressed as a single CSS `transform`. Transforms are composited on the
 * GPU, so rotating the picture costs no layout, no reflow and no repaint of
 * the video surface - which is exactly what a Haswell iGPU needs.
 */

/**
 * Compute the transform for a video painted with `object-fit: contain`
 * inside a `stageW x stageH` element.
 *
 * @param {object} o
 * @param {number} o.stageW      stage width in CSS px
 * @param {number} o.stageH      stage height in CSS px
 * @param {number} o.videoW      intrinsic frame width
 * @param {number} o.videoH      intrinsic frame height
 * @param {number} o.rotation    0 | 90 | 180 | 270
 * @param {string} o.fit         "contain" | "cover" | "stretch"
 * @param {number} o.aspect      forced display aspect, 0 = use native
 * @param {boolean} o.mirror     flip horizontally
 * @returns {{transform: string, contentW: number, contentH: number}}
 */
export function computeTransform({
  stageW,
  stageH,
  videoW,
  videoH,
  rotation = 0,
  fit = "contain",
  aspect = 0,
  mirror = false,
}) {
  if (!stageW || !stageH || !videoW || !videoH) {
    return { transform: "translate(-50%, -50%)", contentW: 0, contentH: 0 };
  }

  const nativeAspect = videoW / videoH;
  const targetAspect = aspect > 0 ? aspect : nativeAspect;

  // 1. Where `object-fit: contain` puts the picture inside the element box.
  //    This is our starting rectangle; it uses the *native* aspect.
  const baseW = Math.min(stageW, stageH * nativeAspect);
  const baseH = baseW / nativeAspect;

  // 2. Anamorphic correction: squeeze/stretch X until the displayed
  //    rectangle has the requested display aspect.
  const anamorphic = targetAspect / nativeAspect;
  const contentW = baseW * anamorphic;
  const contentH = baseH;

  // 3. After rotation the rectangle's screen-space footprint swaps.
  const quarterTurn = rotation === 90 || rotation === 270;
  const screenW = quarterTurn ? contentH : contentW;
  const screenH = quarterTurn ? contentW : contentH;

  // 4. Scale so that footprint fits (or fills) the stage.
  let sx;
  let sy;
  if (fit === "stretch") {
    // Non-uniform scale has to be expressed in the element's own,
    // pre-rotation coordinate frame, hence the swap for quarter turns.
    sx = quarterTurn ? stageH / contentW : stageW / contentW;
    sy = quarterTurn ? stageW / contentH : stageH / contentH;
  } else {
    const pick = fit === "cover" ? Math.max : Math.min;
    const k = pick(stageW / screenW, stageH / screenH);
    sx = k;
    sy = k;
  }

  if (mirror) sx = -sx;

  // CSS applies the right-most function first, so read this backwards:
  // anamorphic squeeze -> fit scale -> rotate -> centre on the stage.
  const parts = [
    "translate(-50%, -50%)",
    rotation ? `rotate(${rotation}deg)` : "",
    `scale(${round(sx)}, ${round(sy)})`,
    anamorphic !== 1 ? `scaleX(${round(anamorphic)})` : "",
  ].filter(Boolean);

  // Screen-space footprint after local scaling, then rotation.
  const localW = contentW * Math.abs(sx);
  const localH = contentH * Math.abs(sy);

  return {
    transform: parts.join(" "),
    contentW: quarterTurn ? localH : localW,
    contentH: quarterTurn ? localW : localH,
  };
}

function round(n) {
  // 4 decimals is well under a subpixel at 4K and keeps the style string
  // short, which matters because this string is written on every resize.
  return Math.round(n * 10000) / 10000;
}

/** Next angle in the 0 -> 90 -> 180 -> 270 ring. */
export function nextRotation(current, step = 90) {
  return (((current + step) % 360) + 360) % 360;
}
