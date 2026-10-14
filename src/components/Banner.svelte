<script>
  import { createEventDispatcher } from "svelte";
  export let message = "";
  export let kind = "error"; // error | info
  const dispatch = createEventDispatcher();
</script>

{#if message}
  <div class="banner" class:info={kind === "info"} role="alert">
    <span>{message}</span>
    <button on:click={() => dispatch("dismiss")} aria-label="Dismiss">✕</button>
  </div>
{/if}

<style>
  .banner {
    position: absolute;
    /* --safe-*: system bars on Android (lib/uvc.js), unset elsewhere. */
    top: calc(12px + var(--safe-top, 0px));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(560px, calc(100% - 24px));
    padding: 8px 8px 8px 12px;
    border-radius: 10px;
    background: rgba(60, 16, 16, 0.94);
    border: 1px solid rgba(255, 107, 107, 0.5);
    color: #ffdede;
    font-size: 12.5px;
    line-height: 1.45;
  }

  .banner.info {
    background: rgba(16, 34, 56, 0.94);
    border-color: rgba(76, 154, 255, 0.5);
    color: #dbe9ff;
  }

  .banner span {
    overflow-wrap: anywhere;
  }

  button {
    flex: 0 0 auto;
    height: 24px;
    padding: 0 8px;
    background: transparent;
    border-color: transparent;
    color: inherit;
  }
</style>
