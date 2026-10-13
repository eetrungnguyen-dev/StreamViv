<script>
  /**
   * HTML context menu - the fallback for `vite dev` in a browser.
   *
   * Inside the app the menu is drawn natively by the OS (see
   * src/lib/context-menu.js); this exists so the same actions are reachable
   * when the frontend is run as a plain web page, with no Tauri behind it.
   *
   * It renders `contextMenuItems()` - the same list the native menu is built
   * from - and emits the chosen item's id, so neither the items nor the
   * handlers are duplicated.
   */
  import { createEventDispatcher } from "svelte";
  import { settings } from "../lib/settings.js";
  import { contextMenuItems } from "../lib/menu-items.js";

  export let visible = false;
  export let x = 0;
  export let y = 0;

  const dispatch = createEventDispatcher();

  let menuEl;
  let left = 0;
  let top = 0;

  $: items = contextMenuItems($settings);
  $: if (visible && menuEl) place(x, y);

  function place(px, py) {
    // Measured, not estimated: the element is in the DOM by now. A menu
    // opened near an edge must not hang off the window - unlike a native
    // menu, this one cannot escape it.
    const pad = 6;
    left = Math.max(pad, Math.min(px, window.innerWidth - menuEl.offsetWidth - pad));
    top = Math.max(pad, Math.min(py, window.innerHeight - menuEl.offsetHeight - pad));
  }

  function close() {
    dispatch("close");
  }

  function choose(id) {
    dispatch("command", id);
    close();
  }
</script>

<!-- Resize re-places rather than closes: phones resize under an open menu
     (system bars, folding), and a menu that vanishes reads as broken. -->
<svelte:window on:blur={close} on:resize={() => visible && menuEl && place(x, y)} />

{#if visible}
  <!-- Swallows the dismissing click so it cannot also reach the video. -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="backdrop"
    on:pointerdown|preventDefault|stopPropagation={close}
    on:contextmenu|preventDefault={close}
  />

  <div class="menu" bind:this={menuEl} style:left="{left}px" style:top="{top}px" role="menu">
    {#each items as item}
      {#if item.separator}
        <div class="sep" />
      {:else}
        <button role="menuitem" on:click={() => choose(item.id)}>
          <span class="check" class:on={item.checked === true}>
            {item.checked === true ? "✓" : ""}
          </span>
          <span class="label">{item.label}</span>
          <kbd>{item.hint || item.accelerator || ""}</kbd>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .menu {
    position: fixed;
    z-index: 41;
    min-width: 220px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .check {
    width: 12px;
    color: var(--accent);
  }

  .label {
    flex: 1;
  }

  kbd {
    color: var(--text-dim);
    font-family: inherit;
    font-size: 11px;
  }

  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--panel-border);
  }
</style>
