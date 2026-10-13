<script>
  import { onMount, tick } from "svelte";
  import { computeTransform } from "../lib/transform.js";
  import { layoutUvc } from "../lib/uvc.js";
  import { FULL_FRAME, normalizeCrop } from "../lib/crop.js";
  import CropEditor from "./CropEditor.svelte";

  /** @type {MediaStream|null} */
  export let stream = null;
  export let rotation = 0;
  export let fit = "contain";
  export let aspect = 0;
  export let mirror = false;
  export let muted = true;
  export let hideCursor = false;
  /** The part of the frame to show (fractions); see lib/crop.js. */
  export let crop = FULL_FRAME;
  /** Show the whole frame with the crop editor over it. */
  export let editingCrop = false;

  /** Intrinsic frame size, published upwards for the stats overlay. */
  export let videoWidth = 0;
  export let videoHeight = 0;

  let stageEl;
  let videoEl;
  let stageW = 0;
  let stageH = 0;
  let transform = "translate(-50%, -50%)";
  // The cropped picture's box (`boxW` x `boxH`, 0 = not known yet) and where
  // the whole video sits inside it so that only the crop shows.
  let boxW = 0;
  let boxH = 0;
  let view = { w: 0, h: 0, x: 0, y: 0 };
  let frame = 0;

  // Recomputing is pure arithmetic, but the *write* to style.transform is
  // what the compositor sees, so it is coalesced into one rAF callback per
  // burst of resize/rotation events.
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      apply();
    });
  }

  function apply() {
    // A crop is just a smaller source: the fit/rotate maths runs on the
    // cropped size, and the frame box it produces clips the full video.
    const c = normalizeCrop(crop);
    const t = computeTransform({
      stageW,
      stageH,
      videoW: videoWidth * c.w,
      videoH: videoHeight * c.h,
      rotation,
      fit,
      aspect,
      mirror,
    });
    transform = t.transform;
    boxW = t.baseW;
    boxH = t.baseH;
    view = t.baseW
      ? { w: t.baseW / c.w, h: t.baseH / c.h, x: (-c.x * t.baseW) / c.w, y: (-c.y * t.baseH) / c.h }
      : { w: 0, h: 0, x: 0, y: 0 };
    if (stream?.native && t.baseW) {
      // Android: the picture is a native view behind the page; give it the
      // box the frame occupies, and the same transform and crop as numbers.
      const r = stageEl.getBoundingClientRect();
      layoutUvc({
        x: r.left + (stageW - t.baseW) / 2,
        y: r.top + (stageH - t.baseH) / 2,
        w: t.baseW,
        h: t.baseH,
        rotation,
        sx: t.scaleX,
        sy: t.scaleY,
        crop: c,
      });
    }
  }

  // Any change to these inputs needs a new transform.
  $: rotation, fit, aspect, mirror, crop, stageW, stageH, videoWidth, videoHeight, schedule();

  function onMeta() {
    videoWidth = videoEl.videoWidth;
    videoHeight = videoEl.videoHeight;
    schedule();
  }

  $: if (videoEl && stream !== undefined) attach(stream);

  async function attach(s) {
    if (s?.native) {
      videoEl.srcObject = null;
      videoWidth = s.width;
      videoHeight = s.height;
      schedule();
      return;
    }
    if (videoEl.srcObject === s) return;
    videoEl.srcObject = s;
    videoWidth = 0;
    videoHeight = 0;
    if (!s) return;
    await tick();
    try {
      await videoEl.play();
    } catch (err) {
      // Autoplay can be refused before the first user gesture; the click
      // handler below picks it up again.
      console.warn("[video] autoplay refused:", err);
    }
  }

  onMount(() => {
    // ResizeObserver instead of a window resize listener: it also fires
    // when the window gains/loses decorations on the fullscreen toggle,
    // and it delivers the already-computed box so we never force a
    // synchronous layout by reading offsetWidth.
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      stageW = box.width;
      stageH = box.height;
    });
    ro.observe(stageEl);
    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  });
</script>

<!-- The stage is a passive surface; double-click is a convenience duplicate of
     the F / F11 shortcut and the toolbar button, so there is no keyboard trap. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="stage" bind:this={stageEl} class:hide-cursor={hideCursor} on:dblclick>
  <!-- The frame is the (cropped) picture's box; it carries the transform and
       clips the video, which is sized and offset so only the crop shows. -->
  <div
    class="frame"
    style:transform
    style:width={boxW ? `${boxW}px` : null}
    style:height={boxH ? `${boxH}px` : null}
  >
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    bind:this={videoEl}
    class:hidden={!stream || stream.native}
    style:width={view.w ? `${view.w}px` : null}
    style:height={view.h ? `${view.h}px` : null}
    style:left={view.w ? `${view.x}px` : null}
    style:top={view.h ? `${view.y}px` : null}
    playsinline
    autoplay
    {muted}
    disablepictureinpicture
    on:loadedmetadata={onMeta}
    on:resize={onMeta}
    on:pause={() => videoEl && videoEl.play().catch(() => {})}
    on:click={() => videoEl && videoEl.paused && videoEl.play().catch(() => {})}
  />
  </div>
  {#if editingCrop && boxW}
    <!-- While editing, the whole frame is shown unrotated, so the box above
         is exactly the frame on screen. -->
    <CropEditor
      left={(stageW - boxW) / 2}
      top={(stageH - boxH) / 2}
      width={boxW}
      height={boxH}
      frameW={videoWidth}
      frameH={videoHeight}
      on:apply
      on:cancel
    />
  {/if}
  {#if !stream}
    <div class="placeholder">
      <slot name="placeholder" />
    </div>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
    /* Promote the stage to its own compositor layer so the rotating video
       never forces the rest of the page to repaint. */
    contain: strict;
  }

  .hide-cursor {
    cursor: none;
  }

  .frame {
    position: absolute;
    top: 50%;
    left: 50%;
    /* Until the frame size is known the box is the stage, and `contain`
       below gives the usual starting rectangle. Afterwards it is exactly
       the (cropped) picture, which transform.js fits from. */
    width: 100%;
    height: 100%;
    overflow: hidden;
    transform-origin: 50% 50%;
    /* The three lines that make rotation free on an HD 4400: keep the
       layer promoted, tell the compositor a transform is coming, and stop
       it from allocating a back face it will never draw. */
    will-change: transform;
    backface-visibility: hidden;
    transform: translate(-50%, -50%);
  }

  video {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  video.hidden {
    visibility: hidden;
  }

  video::-webkit-media-controls {
    display: none !important;
  }

  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
    color: var(--text-dim);
    pointer-events: none;
  }
</style>
