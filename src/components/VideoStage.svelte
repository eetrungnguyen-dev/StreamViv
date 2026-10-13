<script>
  import { onMount, tick } from "svelte";
  import { computeTransform } from "../lib/transform.js";
  import { layoutUvc } from "../lib/uvc.js";

  /** @type {MediaStream|null} */
  export let stream = null;
  export let rotation = 0;
  export let fit = "contain";
  export let aspect = 0;
  export let mirror = false;
  export let muted = true;
  export let hideCursor = false;

  /** Intrinsic frame size, published upwards for the stats overlay. */
  export let videoWidth = 0;
  export let videoHeight = 0;

  let stageEl;
  let videoEl;
  let stageW = 0;
  let stageH = 0;
  let transform = "translate(-50%, -50%)";
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
    const t = computeTransform({
      stageW,
      stageH,
      videoW: videoWidth,
      videoH: videoHeight,
      rotation,
      fit,
      aspect,
      mirror,
    });
    transform = t.transform;
    if (stream?.native && t.baseW) {
      // Android: the picture is a native view behind the page; give it the
      // box <video> would paint into, and the same transform as numbers.
      const r = stageEl.getBoundingClientRect();
      layoutUvc({
        x: r.left + (stageW - t.baseW) / 2,
        y: r.top + (stageH - t.baseH) / 2,
        w: t.baseW,
        h: t.baseH,
        rotation,
        sx: t.scaleX,
        sy: t.scaleY,
      });
    }
  }

  // Any change to these inputs needs a new transform.
  $: rotation, fit, aspect, mirror, stageW, stageH, videoWidth, videoHeight, schedule();

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
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    bind:this={videoEl}
    class:hidden={!stream || stream.native}
    style:transform
    playsinline
    autoplay
    {muted}
    disablepictureinpicture
    on:loadedmetadata={onMeta}
    on:resize={onMeta}
    on:pause={() => videoEl && videoEl.play().catch(() => {})}
    on:click={() => videoEl && videoEl.paused && videoEl.play().catch(() => {})}
  />
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

  video {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    /* The element box never changes; `contain` gives us a predictable
       starting rectangle that transform.js does the real fitting from. */
    object-fit: contain;
    transform-origin: 50% 50%;
    /* The three lines that make rotation free on an HD 4400: keep the
       layer promoted, tell the compositor a transform is coming, and stop
       it from allocating a back face it will never draw. */
    will-change: transform;
    backface-visibility: hidden;
    transform: translate(-50%, -50%);
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
