// ESM, not require(): the package is "type": "module", and Bun tolerated
// the mismatch where Node does not - so this file only ran under Bun.
import { chromium } from "playwright-core";
const OUT = process.env.CCV_E2E_OUT || "/tmp";
const URL = "http://localhost:4173/__smoke.html";

const fail = [];
const near = (a, b, eps = 0.75) => Math.abs(a - b) <= eps;
const r2 = (n) => Math.round(n * 100) / 100;

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fail.push(name);
}

/**
 * Wait until the video's inline transform satisfies a JS expression (given
 * as source text, with the transform bound to `t`), instead of sleeping a
 * fixed amount. Rotation lands on the next animation frame, and a loaded
 * machine can miss a fixed 180ms budget.
 */
async function waitForTransform(page, exprSrc, label) {
  try {
    await page.waitForFunction(
      (src) => {
        const f = document.querySelector(".frame");
        return !!f && new Function("t", "return (" + src + ")")(f.style.transform);
      },
      exprSrc,
      { timeout: 3000, polling: 50 }
    );
  } catch {
    console.log(`  (timed out waiting for ${label})`);
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    permissions: ["camera", "microphone"],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const vid = page.locator("video");
  const readState = () =>
    page.evaluate(() => {
      const v = document.querySelector("video");
      // The transform lives on the frame that clips the (cropped) video.
      const f = document.querySelector(".frame");
      return {
        transform: getComputedStyle(f).transform,
        inline: f.style.transform,
        vw: v.videoWidth,
        vh: v.videoHeight,
        hasStream: !!v.srcObject,
        paused: v.paused,
        box: { width: f.offsetWidth, height: f.offsetHeight },
        content: (() => {
          // Independent check: take the object-fit content box, push it
          // through the *computed* matrix, and see what the user actually
          // sees. Deliberately does not reuse transform.js.
          // The frame box is the (cropped) picture, so its aspect is the
          // picture's; with no crop it equals the video's.
          const a = f.offsetWidth / f.offsetHeight;
          if (!a) return { width: 0, height: 0 };
          const cw = Math.min(f.offsetWidth, f.offsetHeight * a);
          const ch = cw / a;
          const m = new DOMMatrix(getComputedStyle(f).transform);
          const lin = (x, y) => [m.a * x + m.c * y, m.b * x + m.d * y];
          const pts = [[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]]
            .map(([x, y]) => lin(x, y));
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        })(),
        stage: (() => {
          const r = document.querySelector(".stage").getBoundingClientRect();
          return { width: r.width, height: r.height };
        })(),
        toolbarOpacity: getComputedStyle(document.querySelector(".toolbar")).opacity,
        bodyScrollW: document.body.scrollWidth,
        objectFit: getComputedStyle(v).objectFit,
        willChange: getComputedStyle(f).willChange,
      };
    });

  let s = await readState();
  check("stream attached to <video>", s.hasStream);
  check("video is playing", !s.paused);
  check("frame size negotiated", s.vw === 1920 && s.vh === 1080, `${s.vw}x${s.vh}`);
  check("object-fit is contain", s.objectFit === "contain");
  check("will-change: transform is set (GPU layer)", s.willChange.includes("transform"));
  check("element layout box matches the stage", s.box.width === 1600 && s.box.height === 900,
    `${s.box.width}x${s.box.height}`);
  check("unrotated picture fills the window exactly",
    near(s.content.width, 1600) && near(s.content.height, 900),
    `${r2(s.content.width)}x${r2(s.content.height)}`);
  check("rotation 0 applies no rotate", !s.inline.includes("rotate"), s.inline);
  await page.screenshot({ path: `${OUT}/shot-0.png` });

  // Constraint ladder: the harness rejects exact 60fps, so the app must have
  // fallen back and still produced a picture.
  const cons = await page.evaluate(() => window.__lastConstraints);
  check("getUserMedia was called with a deviceId", !!(cons && cons.video && cons.video.deviceId),
    JSON.stringify(cons && cons.video));

  // --- Rotation via the R hotkey ---
  const seen = [];
  for (const expect of [90, 180, 270, 0]) {
    await page.keyboard.press("r");
    await waitForTransform(
      page,
      expect === 0 ? '!t.includes("rotate")' : `t.includes("rotate(${expect}deg)")`,
      `rotate ${expect}`
    );
    s = await readState();
    seen.push(s.inline);
    const wants = expect === 0 ? !s.inline.includes("rotate") : s.inline.includes(`rotate(${expect}deg)`);
    check(`R cycles to ${expect}deg`, wants, s.inline);
    if (expect === 90) {
      // 16:9 rotated into a 1600x900 window must letterbox to 900 tall.
      check("90deg keeps aspect (scale ~0.5625)", /scale\(0\.5625, 0\.5625\)/.test(s.inline), s.inline);
      // The element's *layout* box must be untouched: that is what proves
      // rotation costs no reflow, only a compositor transform.
      check("element layout box unchanged after rotation (no reflow)",
        s.box.width === 1600 && s.box.height === 900, `${s.box.width}x${s.box.height}`);
      check("rotated picture letterboxes to the window height",
        near(s.content.height, 900) && near(s.content.width, 506.25),
        `${r2(s.content.width)}x${r2(s.content.height)}`);
      check("rotated picture keeps a 9:16 shape",
        near(s.content.width / s.content.height, 9 / 16, 0.001),
        (s.content.width / s.content.height).toFixed(4));
      await page.screenshot({ path: `${OUT}/shot-90.png` });
    }
    if (expect === 180) await page.screenshot({ path: `${OUT}/shot-180.png` });
  }

  // The reload shortcut must rotate rather than reload, on whichever
  // modifier this host uses - Cmd on macOS, Ctrl elsewhere. Chromium reports
  // the real platform, so the app binds the same key Playwright must press.
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.evaluate(() => (window.__stillHere = true));
  await page.keyboard.press(`${mod}+r`);
  await waitForTransform(page, 't.includes("rotate(90deg)")', `${mod}+r rotate 90`);
  s = await readState();
  const stillHere = await page.evaluate(() => window.__stillHere === true);
  check(`${mod}+R rotates instead of reloading`, stillHere && s.inline.includes("rotate(90deg)"), s.inline);

  // Shift+R goes back.
  await page.keyboard.press("Shift+R");
  await waitForTransform(page, '!t.includes("rotate")', "shift+r back to 0");
  s = await readState();
  check("Shift+R rotates counter-clockwise", !s.inline.includes("rotate"), s.inline);

  // --- Persistence ---
  await page.keyboard.press("r"); // 90
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => localStorage.getItem("ccv.settings.v2"));
  check("settings persisted to localStorage", !!stored && JSON.parse(stored).rotation === 90, stored || "");

  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  s = await readState();
  check("rotation survives a restart", s.inline.includes("rotate(90deg)"), s.inline);
  check("device reopened automatically after restart", s.hasStream && !s.paused);

  // --- Auto-hide toolbar ---
  await page.mouse.move(800, 450);
  await page.waitForTimeout(200);
  s = await readState();
  check("toolbar shows on pointer move", s.toolbarOpacity === "1", s.toolbarOpacity);
  await page.waitForTimeout(3600);
  s = await readState();
  check("toolbar fades after ~3s idle", s.toolbarOpacity === "0", s.toolbarOpacity);
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector(".stage")).cursor);
  check("cursor hides with the toolbar", cursor === "none", cursor);
  await page.mouse.move(801, 451);
  await page.waitForTimeout(300);
  s = await readState();
  check("toolbar comes back on movement", s.toolbarOpacity === "1", s.toolbarOpacity);

  // --- Toolbar modes: auto -> always on -> hidden -> auto ---
  await page.keyboard.press("t"); // always on
  await page.waitForTimeout(3600);
  s = await readState();
  check("pinned toolbar ignores the idle timeout", s.toolbarOpacity === "1", s.toolbarOpacity);

  await page.keyboard.press("t"); // hidden
  await page.waitForTimeout(300);
  s = await readState();
  check("hidden toolbar goes away immediately", s.toolbarOpacity === "0", s.toolbarOpacity);
  // The distinguishing property: movement does NOT bring it back. Auto-hide
  // would have re-shown it here.
  await page.mouse.move(700, 400);
  await page.waitForTimeout(300);
  s = await readState();
  check("hidden toolbar stays hidden through pointer movement", s.toolbarOpacity === "0", s.toolbarOpacity);

  await page.keyboard.press("t"); // back to auto
  await page.mouse.move(701, 401);
  await page.waitForTimeout(300);
  s = await readState();
  check("T cycles back round to auto-hide", s.toolbarOpacity === "1", s.toolbarOpacity);

  // --- Fit modes, measured while rotated 90 (the interesting case) ---
  await page.keyboard.press("c"); // cover
  await page.waitForTimeout(200);
  s = await readState();
  check("C switches to fill/cover: covers the window, crops the overflow",
    s.content.width >= 1600 - 0.5 && s.content.height >= 900 - 0.5 && s.content.height > 900,
    `${r2(s.content.width)}x${r2(s.content.height)}`);
  check("cover keeps the aspect ratio (uniform scale)",
    near(s.content.width / s.content.height, 9 / 16, 0.001), s.inline);

  await page.keyboard.press("c"); // stretch
  await page.waitForTimeout(200);
  s = await readState();
  check("C switches to stretch: fills the window exactly",
    near(s.content.width, 1600) && near(s.content.height, 900),
    `${r2(s.content.width)}x${r2(s.content.height)}`);

  await page.keyboard.press("c"); // back to contain
  await page.waitForTimeout(200);
  s = await readState();
  check("C returns to fit/letterbox", near(s.content.width, 506.25), s.inline);

  // --- Crop: X edits over the whole frame, typed 800x600 then fills ---
  await page.keyboard.press("x");
  await page.waitForTimeout(250);
  check("X opens the crop editor", (await page.locator(".area").count()) === 1);
  const area = await page.locator(".area").boundingBox();
  check("editor shows the whole frame unrotated",
    !!area && near(area.width, 1600, 1) && near(area.height, 900, 1),
    area ? `${r2(area.width)}x${r2(area.height)}` : "none");
  await page.mouse.move(area.x + area.width * 0.25, area.y + area.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.5, area.y + area.height * 0.75, { steps: 6 });
  await page.mouse.up();
  let sizeLabel = (await page.locator(".size").innerText()).trim();
  check("dragging draws a box (in source pixels)", sizeLabel === "480 × 540", sizeLabel);
  await page.locator(".panel input").nth(0).fill("800");
  await page.locator(".panel input").nth(0).dispatchEvent("change");
  await page.locator(".panel input").nth(1).fill("600");
  await page.locator(".panel input").nth(1).dispatchEvent("change");
  sizeLabel = (await page.locator(".size").innerText()).trim();
  check("typing 800 x 600 sets the box exactly", sizeLabel === "800 × 600", sizeLabel);
  await page.screenshot({ path: `${OUT}/shot-crop-editor.png` });
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(300);
  s = await readState();
  check("Apply closes the editor", (await page.locator(".area").count()) === 0);
  check("4:3 crop at 90deg fills the height (675x900)",
    near(s.content.width, 675) && near(s.content.height, 900),
    `${r2(s.content.width)}x${r2(s.content.height)}`);
  await page.screenshot({ path: `${OUT}/shot-crop.png` });
  await page.waitForTimeout(300); // settings writes are debounced
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ccv.settings.v2") || "{}").crop);
  check("crop is persisted", !!saved && saved.w < 1, JSON.stringify(saved));
  // Reset through the same command the context menu uses.
  await page.keyboard.press("x");
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Full frame" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(300);
  s = await readState();
  check("Full frame restores the uncropped picture", near(s.content.width, 506.25), s.inline);

  // --- Frame-rate fallback ladder, end to end ---
  await page.mouse.move(800, 450);
  await page.waitForTimeout(150);
  await page.selectOption("#fps", "60"); // harness refuses exact 60
  await page.waitForTimeout(900);
  const bannerText = await page.locator(".banner").innerText().catch(() => "");
  check("exact 60 fps is refused and the app degrades instead of failing",
    /refused the exact mode/i.test(bannerText), bannerText.replace(/\n/g, " "));
  s = await readState();
  check("picture survives the fallback", s.hasStream && !s.paused && s.vw === 1920);
  const cons2 = await page.evaluate(() => window.__lastConstraints);
  check("fallback tier asked for an ideal (not exact) 60 fps",
    !!(cons2 && cons2.video && cons2.video.frameRate && cons2.video.frameRate.ideal === 60),
    JSON.stringify(cons2 && cons2.video));
  await page.selectOption("#fps", "auto");
  await page.waitForTimeout(700);

  // --- Info + help overlays ---
  await page.keyboard.press("i");
  await page.waitForTimeout(250);
  const statsText = await page.locator(".stats").innerText().catch(() => "");
  check("Info overlay reports the live signal", /1920/.test(statsText) && /1080/.test(statsText),
    statsText.replace(/\n/g, " | "));
  await page.keyboard.press("?");
  await page.waitForTimeout(250);
  check("Help overlay lists shortcuts", (await page.locator(".help").count()) === 1);
  await page.screenshot({ path: `${OUT}/shot-overlays.png` });
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");

  // --- Narrow window (phone width) ---
  await page.setViewportSize({ width: 360, height: 740 });
  await page.mouse.move(180, 370);
  await page.waitForTimeout(500);
  s = await readState();
  check("no horizontal page overflow at 360px", s.bodyScrollW <= 360, `scrollWidth=${s.bodyScrollW}`);
  check("frame box is the picture's contain box on the narrow stage",
    s.box.width === 360 && Math.abs(s.box.height - 202.5) <= 1, `${s.box.width}x${s.box.height}`);
  check("picture stays inside the narrow stage (no crop, no overflow)",
    s.content.width <= s.stage.width + 1 && s.content.height <= s.stage.height + 1,
    `content ${r2(s.content.width)}x${r2(s.content.height)} in stage ${r2(s.stage.width)}x${r2(s.stage.height)}`);
  const toolbarFits = await page.evaluate(() => {
    const t = document.querySelector(".toolbar").getBoundingClientRect();
    return t.left >= -0.5 && t.right <= window.innerWidth + 0.5;
  });
  check("toolbar stays within a 360px viewport", toolbarFits);
  await page.screenshot({ path: `${OUT}/shot-360.png` });

  await page.setViewportSize({ width: 1600, height: 900 });
  check("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" ;; "));

  await browser.close();
  console.log(`\n${fail.length === 0 ? "ALL CHECKS PASSED" : "FAILURES: " + fail.join(", ")}`);
  process.exit(fail.length === 0 ? 0 : 1);
})();
