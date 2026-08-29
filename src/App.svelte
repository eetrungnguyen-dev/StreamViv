<script>
  import { onMount, onDestroy } from "svelte";
  import VideoStage from "./components/VideoStage.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import StatusOverlay from "./components/StatusOverlay.svelte";
  import Banner from "./components/Banner.svelte";
  import ContextMenu from "./components/ContextMenu.svelte";
  import { listenForMenuCommands, showNativeContextMenu } from "./lib/context-menu.js";
  import { settings, updateSettings, flushSettings, currentSettings } from "./lib/settings.js";
  import { idle } from "./lib/idle.js";
  import { matchBinding } from "./lib/hotkeys.js";
  import { setFullscreen, isFullscreen, setDecorations } from "./lib/tauri.js";
  import { nextRotation } from "./lib/transform.js";
  import {
    aspectByValue,
    FIT_MODES,
    TOOLBAR_HIDDEN,
    TOOLBAR_PINNED,
    nextToolbarMode,
    toolbarModeByValue,
  } from "./lib/constants.js";
  import {
    primePermissions,
    listDevices,
    resolveDevice,
    openVideoStream,
    openAudioStream,
    stopStream,
  } from "./lib/capture.js";

  let videoDevices = [];
  let audioDevices = [];

  let videoStream = null;
  let audioStream = null;
  let audioEl;

  let stats = null;
  let audioStats = null;
  let tier = "";
  let degraded = false;

  let busy = false;
  let banner = "";
  let bannerKind = "error";
  let showHelp = false;
  let menuOpen = false;
  let menuX = 0;
  let menuY = 0;

  let videoWidth = 0;
  let videoHeight = 0;

  // Guards against two overlapping restarts (fast device switching, or a
  // devicechange event landing mid-negotiation) fighting over the card.
  let startToken = 0;

  $: aspectRatio = aspectByValue($settings.aspect).ratio;
  // "hidden" wins over everything, including pointer movement; that is the
  // whole point of it. Otherwise it is the old behaviour: always up when
  // pinned, up until the pointer goes still when not.
  $: chromeVisible =
    $settings.toolbarMode !== TOOLBAR_HIDDEN &&
    ($settings.toolbarMode === TOOLBAR_PINNED || !$idle);

  // Audio playback is a presentation concern: never tear the stream down
  // for a volume change.
  $: if (audioEl) {
    audioEl.volume = $settings.muted ? 0 : $settings.volume;
    audioEl.muted = $settings.muted;
  }

  function say(message, kind = "error") {
    banner = message;
    bannerKind = kind;
  }

  async function refreshDevices() {
    try {
      const { video, audio } = await listDevices();
      videoDevices = video;
      audioDevices = audio;
    } catch (err) {
      say(`Could not list capture devices: ${err.message || err}`);
    }
  }

  /**
   * Pick the device to use: the remembered one if it is still present
   * (matched by id, then by label so a replugged card is found again),
   * otherwise the first available one.
   */
  function pickVideoDevice(s) {
    const match = resolveDevice(videoDevices, s.videoDeviceId, s.videoDeviceLabel);
    if (match) return match;
    return videoDevices[0] || null;
  }

  function pickAudioDevice(s) {
    // No audio is a legitimate, remembered choice - only auto-pick when
    // nothing has ever been chosen.
    if (!s.audioDeviceId && !s.audioDeviceLabel) return null;
    return resolveDevice(audioDevices, s.audioDeviceId, s.audioDeviceLabel);
  }

  async function startVideo() {
    const token = ++startToken;
    const s = currentSettings();
    const device = pickVideoDevice(s);

    stopStream(videoStream);
    videoStream = null;
    stats = null;
    tier = "";
    degraded = false;

    if (!device) {
      say("No capture device detected. Plug the card in and press Reconnect.");
      return;
    }

    busy = true;
    try {
      const result = await openVideoStream({
        deviceId: device.deviceId,
        resolution: s.resolution,
        frameRate: s.frameRate,
        nativeFrames: s.nativeFrames,
      });
      if (token !== startToken) {
        // A newer start won the race while we were negotiating.
        stopStream(result.stream);
        return;
      }
      videoStream = result.stream;
      stats = result.applied;
      tier = result.tier;
      degraded = result.degraded;

      // Remember what actually worked, including the id the card was given
      // on this plug-in.
      updateSettings({
        videoDeviceId: device.deviceId,
        videoDeviceLabel: device.label,
      });

      if (result.degraded) {
        say(
          `The card refused the exact mode; using "${result.tier}" instead` +
            (stats?.width ? ` (${stats.width}×${stats.height} @ ${stats.frameRate || "?"} fps).` : "."),
          "info"
        );
      } else {
        banner = "";
      }

      watchTrack(result.stream);
    } catch (err) {
      if (token === startToken) say(err.message || String(err));
    } finally {
      if (token === startToken) busy = false;
    }
  }

  async function startAudio() {
    const s = currentSettings();
    stopStream(audioStream);
    audioStream = null;
    audioStats = null;

    const device = pickAudioDevice(s);
    if (!device) return;

    try {
      const result = await openAudioStream({ deviceId: device.deviceId });
      audioStream = result.stream;
      audioStats = result.applied;
      updateSettings({ audioDeviceId: device.deviceId, audioDeviceLabel: device.label });
      if (audioEl) {
        audioEl.srcObject = audioStream;
        await audioEl.play().catch(() => {});
      }
    } catch (err) {
      say(`Could not open the audio input: ${err.message || err}`, "info");
    }
  }

  /** A capture card being unplugged ends the track rather than erroring. */
  function watchTrack(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener("ended", () => {
      if (videoStream === stream) {
        videoStream = null;
        stats = null;
        say("The capture device disappeared. Press Reconnect once it is back.");
      }
    });
  }

  async function reconnect() {
    banner = "";
    await refreshDevices();
    await startVideo();
    await startAudio();
  }

  function onDeviceChange() {
    refreshDevices().then(() => {
      // Only re-open when the stream we are showing is actually gone;
      // an unrelated USB event must not interrupt a healthy picture.
      const s = currentSettings();
      const stillThere = resolveDevice(videoDevices, s.videoDeviceId, s.videoDeviceLabel);
      if (!videoStream || !stillThere) startVideo();
    });
  }

  /**
   * Cycle auto -> always on -> hidden. The mode is announced, because
   * "hidden" is otherwise indistinguishable from a broken toolbar - and the
   * message is the only thing that tells you how to get it back.
   */
  function cycleToolbar() {
    const mode = nextToolbarMode(currentSettings().toolbarMode);
    updateSettings({ toolbarMode: mode });
    const m = toolbarModeByValue(mode);
    say(`Toolbar: ${m.label} - ${m.hint}`, "info");
  }

  function cycleFit() {
    const i = FIT_MODES.findIndex((m) => m.value === currentSettings().fit);
    updateSettings({ fit: FIT_MODES[(i + 1) % FIT_MODES.length].value });
  }

  async function toggleWindowDecorations() {
    const on = !currentSettings().decorations;
    try {
      await setDecorations(on);
      updateSettings({ decorations: on });
    } catch (err) {
      say(`Could not ${on ? "show" : "hide"} the title bar: ${err.message || err}`);
    }
  }

  async function toggleAppFullscreen() {
    const entering = !(await isFullscreen());
    const wantsDecorations = currentSettings().decorations;
    try {
      // Windows rejects fullscreen transitions from a borderless window.
      // Temporarily restore decorations for the transition, then restore the
      // user's title-bar preference after leaving fullscreen.
      if (entering && !wantsDecorations) await setDecorations(true);
      await setFullscreen(entering);
      if (!entering && !wantsDecorations) await setDecorations(false);
    } catch (err) {
      say(`Could not ${entering ? "enter" : "leave"} fullscreen: ${err.message || err}`);
    }
  }

  async function onContextMenu(event) {
    // The webview's own menu has to go either way: on Windows it offers a
    // "Reload" that would drop the capture stream, and on macOS it is empty.
    event.preventDefault();
    menuX = event.clientX;
    menuY = event.clientY;
    // Prefer the OS menu - it brings keyboard navigation, native styling and
    // the ability to run past the window edge. The HTML menu is for `vite
    // dev` in a browser, where there is no such thing.
    const shown = await showNativeContextMenu(currentSettings());
    if (!shown) menuOpen = true;
  }

  function onKeyDown(event) {
    const command = matchBinding(event);
    if (!command) return;
    // Ctrl+R would reload the webview and F11 would trigger the webview's
    // own fullscreen - both have to be swallowed here.
    event.preventDefault();
    runCommand(command);
  }

  /**
   * The single place a command is carried out.
   *
   * Menu item ids are hotkey command names, so the native menu, the HTML
   * fallback menu and the keyboard all arrive here - there is no second,
   * subtly different implementation of "rotate" to drift out of step.
   */
  function runCommand(command) {
    switch (command) {
      case "rotate-cw":
        updateSettings({ rotation: nextRotation(currentSettings().rotation, 90) });
        break;
      case "rotate-ccw":
        updateSettings({ rotation: nextRotation(currentSettings().rotation, -90) });
        break;
      case "fullscreen":
        toggleAppFullscreen();
        break;
      case "exit-fullscreen":
        if (menuOpen) menuOpen = false;
        else if (showHelp) showHelp = false;
        else setFullscreen(false);
        break;
      case "cycle-toolbar":
        cycleToolbar();
        break;
      case "toggle-stats":
        updateSettings({ showStats: !currentSettings().showStats });
        break;
      case "toggle-mute":
        updateSettings({ muted: !currentSettings().muted });
        break;
      case "toggle-decorations":
        toggleWindowDecorations();
        break;
      case "cycle-fit":
        cycleFit();
        break;
      case "toggle-mirror":
        updateSettings({ mirror: !currentSettings().mirror });
        break;
      case "reconnect":
        reconnect();
        break;
      case "toggle-help":
        showHelp = !showHelp;
        break;
    }
  }

  onMount(() => {
    (async () => {
      try {
        await setDecorations(currentSettings().decorations);
      } catch (err) {
        say(`Could not apply the title-bar setting: ${err.message || err}`);
      }
      try {
        await primePermissions();
      } catch (err) {
        say(err.message || String(err));
      }
      await refreshDevices();
      await startVideo();
      await startAudio();
    })();

    navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    window.addEventListener("beforeunload", flushSettings);

    // A choice made in the native menu comes back as an event carrying the
    // command name.
    let stopMenu = () => {};
    listenForMenuCommands(runCommand).then((off) => {
      stopMenu = off;
    });

    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
      window.removeEventListener("beforeunload", flushSettings);
      stopMenu();
    };
  });

  onDestroy(() => {
    stopStream(videoStream);
    stopStream(audioStream);
    flushSettings();
  });
</script>

<svelte:window on:keydown={onKeyDown} on:contextmenu={onContextMenu} />

<main>
  <VideoStage
    stream={videoStream}
    rotation={$settings.rotation}
    fit={$settings.fit}
    aspect={aspectRatio}
    mirror={$settings.mirror}
    muted={true}
    hideCursor={$idle && $settings.toolbarMode !== TOOLBAR_PINNED}
    bind:videoWidth
    bind:videoHeight
    on:dblclick={() => toggleAppFullscreen()}
  >
    <svelte:fragment slot="placeholder">
      <div>
        <p><strong>No picture</strong></p>
        <p>Pick a capture device from the toolbar, or press <kbd>N</kbd> to reconnect.</p>
        <p>Move the mouse to show the toolbar · <kbd>?</kbd> for shortcuts</p>
      </div>
    </svelte:fragment>
  </VideoStage>

  <!-- svelte-ignore a11y-media-has-caption -->
  <audio bind:this={audioEl} autoplay />

  <StatusOverlay
    {stats}
    {audioStats}
    {tier}
    {degraded}
    rotation={$settings.rotation}
    showStats={$settings.showStats}
    {showHelp}
    visible={chromeVisible || $settings.showStats}
  />

  <Banner message={banner} kind={bannerKind} on:dismiss={() => (banner = "")} />

  <ContextMenu
    visible={menuOpen}
    x={menuX}
    y={menuY}
    on:close={() => (menuOpen = false)}
    on:command={(e) => runCommand(e.detail)}
  />

  <Toolbar
    {videoDevices}
    {audioDevices}
    {busy}
    visible={chromeVisible}
    on:restart={(e) => (e.detail.what === "audio" ? startAudio() : startVideo())}
    on:reconnect={reconnect}
    on:fullscreen={() => toggleAppFullscreen()}
  />
</main>

<style>
  main {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #000;
  }

  audio {
    display: none;
  }

  p {
    margin: 0 0 6px;
  }

  kbd {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid var(--panel-border);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    font-family: inherit;
    font-size: 11px;
    color: var(--text);
  }
</style>
