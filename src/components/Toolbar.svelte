<script>
  import { createEventDispatcher } from "svelte";
  import {
    RESOLUTIONS,
    FRAME_RATES,
    FIT_MODES,
    ASPECTS,
    ROTATIONS,
    TOOLBAR_HIDDEN,
    TOOLBAR_PINNED,
    nextToolbarMode,
    toolbarModeByValue,
  } from "../lib/constants.js";
  import { settings, updateSettings } from "../lib/settings.js";
  import { IS_MAC } from "../lib/platform.js";
  import { NATIVE_UVC } from "../lib/uvc.js";

  // Android: a focused <select> holds the toolbar up (lib/idle.js); once a
  // choice is made, let go so it can fade again.
  function releasePicker(event) {
    if (NATIVE_UVC && event.target.tagName === "SELECT") event.target.blur();
  }

  export let videoDevices = [];
  export let audioDevices = [];
  export let visible = true;
  export let busy = false;

  const dispatch = createEventDispatcher();

  // F11 is the Windows/Linux fullscreen key; on macOS it belongs to
  // Mission Control, so the tooltip advertises the native combination.
  const fullscreenHint = IS_MAC ? "Fullscreen (F / Cmd+Ctrl+F)" : "Fullscreen (F / F11)";

  function onVideoDevice(event) {
    const id = event.currentTarget.value;
    const dev = videoDevices.find((d) => d.deviceId === id);
    updateSettings({ videoDeviceId: id, videoDeviceLabel: dev ? dev.label : "" });
    dispatch("restart", { what: "video" });
  }

  function onAudioDevice(event) {
    const id = event.currentTarget.value;
    const dev = audioDevices.find((d) => d.deviceId === id);
    updateSettings({ audioDeviceId: id, audioDeviceLabel: dev ? dev.label : "" });
    dispatch("restart", { what: "audio" });
  }

  // Resolution and frame rate are the only two settings that require a new
  // getUserMedia call; everything else is a pure presentation change and
  // must never interrupt the stream.
  function onResolution(event) {
    updateSettings({ resolution: event.currentTarget.value });
    dispatch("restart", { what: "video" });
  }

  function onFrameRate(event) {
    updateSettings({ frameRate: event.currentTarget.value });
    dispatch("restart", { what: "video" });
  }
</script>

<div class="toolbar" class:visible aria-hidden={!visible} on:change={releasePicker}>
  <div class="group">
    <label for="videoDevice">Video</label>
    <select
      id="videoDevice"
      value={$settings.videoDeviceId}
      on:change={onVideoDevice}
      disabled={busy}
      title="Capture device"
    >
      <option value="">— none —</option>
      {#each videoDevices as d (d.deviceId)}
        <option value={d.deviceId}>{d.label}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <label for="resolution">Res</label>
    <select
      id="resolution"
      value={$settings.resolution}
      on:change={onResolution}
      disabled={busy}
      title="Requested capture resolution"
    >
      {#each RESOLUTIONS as r (r.value)}
        <option value={r.value}>{r.label}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <label for="fps">FPS</label>
    <select
      id="fps"
      value={$settings.frameRate}
      on:change={onFrameRate}
      disabled={busy}
      title="Requested frame rate (exact, with fallback)"
    >
      {#each FRAME_RATES as f (f.value)}
        <option value={f.value}>{f.label}</option>
      {/each}
    </select>
  </div>

  <div class="sep" />

  <div class="group rotation" role="group" aria-label="Rotation">
    {#each ROTATIONS as angle}
      <button
        class="rot"
        aria-pressed={$settings.rotation === angle}
        on:click={() => updateSettings({ rotation: angle })}
        title={angle === 90 || angle === 270 ? `${angle}° (portrait)` : `${angle}°`}
      >
        {angle}°
      </button>
    {/each}
  </div>

  <div class="group">
    <label for="fit">Fit</label>
    <select
      id="fit"
      value={$settings.fit}
      on:change={(e) => updateSettings({ fit: e.currentTarget.value })}
    >
      {#each FIT_MODES as m (m.value)}
        <option value={m.value}>{m.label}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <label for="aspect">Aspect</label>
    <select
      id="aspect"
      value={$settings.aspect}
      on:change={(e) => updateSettings({ aspect: e.currentTarget.value })}
      title="Anamorphic correction — use when the card reports the wrong shape"
    >
      {#each ASPECTS as a (a.value)}
        <option value={a.value}>{a.label}</option>
      {/each}
    </select>
  </div>

  <button
    aria-pressed={$settings.mirror}
    on:click={() => updateSettings({ mirror: !$settings.mirror })}
    title="Mirror horizontally">Mirror</button
  >

  <div class="sep" />

  <div class="group">
    <label for="audioDevice">Audio</label>
    <select
      id="audioDevice"
      value={$settings.audioDeviceId}
      on:change={onAudioDevice}
      disabled={busy}
      title="Audio input"
    >
      <option value="">— none —</option>
      {#each audioDevices as d (d.deviceId)}
        <option value={d.deviceId}>{d.label}</option>
      {/each}
    </select>
  </div>

  <button
    aria-pressed={$settings.muted}
    on:click={() => updateSettings({ muted: !$settings.muted })}
    title="Mute (M)">{$settings.muted ? "Muted" : "Sound"}</button
  >
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    value={$settings.volume}
    on:input={(e) => updateSettings({ volume: +e.currentTarget.value })}
    aria-label="Volume"
    title="Volume"
  />

  <div class="sep" />

  <button on:click={() => dispatch("reconnect")} disabled={busy} title="Re-scan and reopen (N)">
    {busy ? "…" : "Reconnect"}
  </button>
  <button on:click={() => dispatch("fullscreen")} title={fullscreenHint}>Full</button>
  <button
    aria-pressed={$settings.showStats}
    on:click={() => updateSettings({ showStats: !$settings.showStats })}
    title="Stream info (I)">Info</button
  >
  <button
    aria-pressed={$settings.toolbarMode === TOOLBAR_PINNED}
    on:click={() => updateSettings({ toolbarMode: nextToolbarMode($settings.toolbarMode) })}
    title="Toolbar: {toolbarModeByValue($settings.toolbarMode).hint} (T to cycle)"
    >{toolbarModeByValue($settings.toolbarMode).label}</button
  >
  <!-- A direct way out, so hiding the toolbar does not require knowing that
       "T" cycles through three modes to get there. -->
  <button
    class="close"
    on:click={() => updateSettings({ toolbarMode: TOOLBAR_HIDDEN })}
    title="Hide the toolbar (T or right-click brings it back)"
    aria-label="Hide the toolbar">✕</button
  >
</div>

<style>
  .close {
    padding-inline: 8px;
    color: var(--text-dim);
  }

  .toolbar {
    position: absolute;
    left: 50%;
    bottom: 16px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 24px);
    padding: 8px 10px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    /* Only opacity and transform animate, so the fade is a compositor-only
       job: no layout, no repaint of the video underneath. */
    transform: translateX(-50%) translateY(8px);
    opacity: 0;
    visibility: hidden;
    will-change: opacity, transform;
    transition: opacity 180ms linear, transform 180ms linear, visibility 0s linear 180ms;
  }

  .toolbar.visible {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(0);
    transition-delay: 0s, 0s, 0s;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  label {
    color: var(--text-dim);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .sep {
    width: 1px;
    height: 20px;
    background: var(--panel-border);
  }

  .rotation {
    gap: 2px;
  }

  .rot {
    min-width: 44px;
    padding: 0 6px;
  }

  /* Small windows and phone-width layouts: the toolbar spans the width and
     scrolls internally rather than growing into a tall wall of rows that
     covers the picture. */
  @media (max-width: 720px) {
    .toolbar {
      left: 8px;
      right: 8px;
      bottom: 8px;
      max-width: none;
      transform: translateY(8px);
      flex-wrap: nowrap;
      justify-content: flex-start;
      overflow-x: auto;
      overscroll-behavior-x: contain;
    }

    .toolbar.visible {
      transform: translateY(0);
    }

    .group {
      flex: 0 0 auto;
    }

    select {
      max-width: 130px;
    }
  }
</style>
