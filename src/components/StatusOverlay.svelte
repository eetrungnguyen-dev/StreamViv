<script>
  import { BINDINGS } from "../lib/hotkeys.js";
  import { platformLabel } from "../lib/platform.js";

  // Which webview we are in decides how the picture is negotiated, so it
  // belongs in the same card as the negotiated mode when reporting a bug.
  const host = platformLabel();

  export let stats = null;
  export let audioStats = null;
  export let tier = "";
  export let degraded = false;
  export let rotation = 0;
  export let showStats = false;
  export let showHelp = false;
  export let visible = true;
</script>

{#if showStats && visible}
  <div class="card stats">
    <div class="row"><span>Device</span><b>{stats?.label || "—"}</b></div>
    <div class="row">
      <span>Signal</span>
      <b>
        {#if stats?.width}
          {stats.width} × {stats.height}
          {#if stats.frameRate}@ {stats.frameRate} fps{/if}
        {:else}
          no stream
        {/if}
      </b>
    </div>
    <div class="row"><span>Rotation</span><b>{rotation}°</b></div>
    <div class="row"><span>Host</span><b>{host}</b></div>
    {#if tier}
      <div class="row" class:warn={degraded}>
        <span>Negotiated</span><b>{tier}</b>
      </div>
    {/if}
    {#if stats?.resizeMode}
      <div class="row"><span>Scaling</span><b>{stats.resizeMode}</b></div>
    {/if}
    {#if audioStats}
      <div class="row">
        <span>Audio</span><b>{audioStats.label || "—"}</b>
      </div>
    {/if}
  </div>
{/if}

{#if showHelp}
  <div class="card help">
    <h2>Shortcuts</h2>
    {#each BINDINGS as b}
      <div class="row"><span>{b.keys}</span><b>{b.action}</b></div>
    {/each}
  </div>
{/if}

<style>
  .card {
    position: absolute;
    padding: 10px 12px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    font-size: 12px;
    max-width: min(420px, calc(100% - 24px));
    pointer-events: none;
  }

  .stats {
    top: 12px;
    left: 12px;
  }

  .help {
    top: 12px;
    right: 12px;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .row {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    line-height: 1.7;
  }

  .row span {
    color: var(--text-dim);
    white-space: nowrap;
  }

  .row b {
    font-weight: 500;
    text-align: right;
    /* Device labels are long, single, unbreakable strings - they must wrap
       instead of pushing the card off the screen. */
    overflow-wrap: anywhere;
  }

  .warn b {
    color: #ffcf6b;
  }
</style>
