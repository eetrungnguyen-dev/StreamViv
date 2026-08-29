import { readable } from "svelte/store";
import { IDLE_TIMEOUT_MS } from "./constants.js";

/**
 * Pointer-idle store. `true` means "the user has not moved the mouse for
 * IDLE_TIMEOUT_MS", which is the cue to fade the toolbar out.
 *
 * Performance notes, because this is the one listener that fires hundreds
 * of times a second on a machine we care about:
 *   - listeners are passive, so they never block scrolling/compositing;
 *   - the store is only written on an actual transition, so a mouse being
 *     dragged around does not trigger a Svelte update per event;
 *   - the timer is rescheduled with a cheap clearTimeout/setTimeout pair
 *     rather than any rAF loop, so an idle app costs literally zero CPU.
 */
export const idle = readable(false, (set) => {
  let timer = 0;
  let isIdle = false;

  const goIdle = () => {
    isIdle = true;
    set(true);
  };

  const wake = () => {
    if (isIdle) {
      isIdle = false;
      set(false);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(goIdle, IDLE_TIMEOUT_MS);
  };

  const events = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"];
  for (const type of events) {
    window.addEventListener(type, wake, { passive: true });
  }

  wake();

  return () => {
    if (timer) clearTimeout(timer);
    for (const type of events) window.removeEventListener(type, wake);
  };
});
