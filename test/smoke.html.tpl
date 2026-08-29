<!--
  Smoke-test harness: the real built bundle, but with a canvas-backed fake
  capture device standing in for the USB card so rotation, fitting and the
  fallback ladder can be exercised in a headless browser.
  Copied into dist/ by test/smoke.sh and removed again afterwards.
-->
<script>
  (function () {
    const FAKE = [
      { deviceId: "fake-video", groupId: "gv", kind: "videoinput", label: "USB3.0 HD Video Capture" },
      { deviceId: "fake-audio", groupId: "ga", kind: "audioinput", label: "USB3.0 HD Audio" },
    ];
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    function paint() {
      ctx.fillStyle = "#123";
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.fillStyle = "#e33";
      ctx.fillRect(0, 0, 1920, 120); // a top bar: makes rotation obvious
      ctx.fillStyle = "#3e3";
      ctx.fillRect(0, 0, 120, 1080); // a left bar
      requestAnimationFrame(paint);
    }
    paint();

    const md = navigator.mediaDevices;
    md.enumerateDevices = async () => FAKE.map((d) => ({ ...d, toJSON: () => d }));
    md.getUserMedia = async (constraints) => {
      window.__lastConstraints = JSON.parse(JSON.stringify(constraints || {}));
      const asked = constraints && constraints.video;
      // Emulate a card that refuses exact 60 fps, so the fallback ladder runs.
      if (asked && asked.frameRate && asked.frameRate.exact === 60) {
        const err = new Error("fps not supported");
        err.name = "OverconstrainedError";
        throw err;
      }
      if (constraints && constraints.audio && !constraints.video) {
        return new AudioContext().createMediaStreamDestination().stream;
      }
      return canvas.captureStream(30);
    };
  })();
</script>
