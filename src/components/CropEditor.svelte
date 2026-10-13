<script>
  /**
   * Drag-a-region crop editor, drawn over the whole (uncropped, unrotated)
   * frame. Drag inside the box to move it, drag a corner to resize, drag
   * anywhere else to draw a new one - or type the size in source pixels.
   * Works the same with a mouse or a finger (pointer events throughout).
   */
  import { createEventDispatcher, onMount } from "svelte";
  import { currentSettings } from "../lib/settings.js";
  import {
    FULL_FRAME,
    cropPixels,
    dragCrop,
    isFullFrame,
    normalizeCrop,
    resizeCropTo,
  } from "../lib/crop.js";

  /** The frame's box on the stage, in CSS px. */
  export let left = 0;
  export let top = 0;
  export let width = 0;
  export let height = 0;
  /** The frame's size in source pixels, for the size readout. */
  export let frameW = 0;
  export let frameH = 0;

  const dispatch = createEventDispatcher();

  let crop = normalizeCrop(currentSettings().crop);
  let drag = null;
  let areaEl;

  $: px = cropPixels(crop, frameW, frameH);

  function point(event) {
    const r = areaEl.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  }

  function onDown(event) {
    if (event.button > 0) return;
    const p = point(event);
    const handle = event.target.dataset?.handle;
    // A full-frame "box" is everywhere, so the first drag draws instead.
    const inside =
      !isFullFrame(crop) && p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
    drag = { mode: handle || (inside ? "move" : "new"), from: p, start: crop };
    areaEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onMove(event) {
    if (!drag) return;
    crop = dragCrop(drag.start, drag.mode, drag.from, point(event));
  }

  function onUp() {
    drag = null;
  }

  function typed(w, h) {
    if (w > 0 && h > 0) crop = resizeCropTo(crop, w, h, frameW, frameH);
  }

  function onKey(event) {
    // Enter applies, Esc cancels - and neither reaches the app's hotkeys.
    if (event.key === "Enter") dispatch("apply", crop);
    else if (event.key === "Escape") dispatch("cancel");
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="area"
  bind:this={areaEl}
  style:left="{left}px"
  style:top="{top}px"
  style:width="{width}px"
  style:height="{height}px"
  on:pointerdown={onDown}
  on:pointermove={onMove}
  on:pointerup={onUp}
  on:pointercancel={onUp}
  on:dblclick|stopPropagation
  on:contextmenu|preventDefault|stopPropagation
>
  <div
    class="box"
    style:left="{crop.x * 100}%"
    style:top="{crop.y * 100}%"
    style:width="{crop.w * 100}%"
    style:height="{crop.h * 100}%"
  >
    {#each ["nw", "ne", "sw", "se"] as h}
      <div class="handle {h}" data-handle={h} />
    {/each}
    <span class="size">{px.width} × {px.height}</span>
  </div>
</div>

<div class="panel" on:pointerdown|stopPropagation>
  <label>
    W <input type="number" min="16" max={frameW} value={px.width}
      on:change={(e) => typed(+e.currentTarget.value, px.height)} />
  </label>
  <label>
    H <input type="number" min="16" max={frameH} value={px.height}
      on:change={(e) => typed(px.width, +e.currentTarget.value)} />
  </label>
  <span class="of">of {frameW} × {frameH}</span>
  <button on:click={() => (crop = FULL_FRAME)}>Full frame</button>
  <button on:click={() => dispatch("cancel")}>Cancel</button>
  <button class="primary" on:click={() => dispatch("apply", crop)}>Apply</button>
</div>

<style>
  .area {
    position: absolute;
    overflow: hidden;
    cursor: crosshair;
    /* A finger drag edits the box; it must not scroll or zoom the page. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    z-index: 20;
  }

  .box {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #fff;
    /* Dims everything outside the crop. */
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.55);
    cursor: move;
  }

  .handle {
    position: absolute;
    width: 28px;
    height: 28px;
    margin: -14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.5);
  }
  .nw { left: 0; top: 0; cursor: nwse-resize; }
  .ne { right: 0; top: 0; cursor: nesw-resize; }
  .sw { left: 0; bottom: 0; cursor: nesw-resize; }
  .se { right: 0; bottom: 0; cursor: nwse-resize; }

  .size {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    white-space: nowrap;
  }

  .panel {
    position: absolute;
    left: 50%;
    bottom: max(16px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 21;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 32px);
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(24, 25, 28, 0.92);
    color: var(--text);
  }

  .panel input {
    width: 5.5em;
  }

  .of {
    color: var(--text-dim);
  }

  .primary {
    font-weight: 600;
  }
</style>
