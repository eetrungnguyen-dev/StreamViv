/**
 * Boots a preview server on :4173, runs the browser smoke test against the
 * real production bundle, then shuts everything down again.
 *
 *   npm run test:e2e
 *
 * Needs a Playwright Chromium; set PLAYWRIGHT_BROWSERS_PATH if it does not
 * live in the default cache.
 */
import { spawn } from "node:child_process";

// node_modules/.bin/vite rather than `bunx`/`npx`: the binary is already
// installed, and naming it directly keeps this script package-manager
// agnostic (and saves a resolver round-trip).
const vite = new URL("../node_modules/.bin/vite", import.meta.url).pathname;
const server = spawn(vite, ["preview", "--port", "4173", "--strictPort"], {
  stdio: "ignore",
  detached: true,
});

const stop = () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

await new Promise((r) => setTimeout(r, 2500));

// process.execPath, not a hard-coded "bun": whichever runtime started this
// script is the one that can run the browser driver.
const test = spawn(process.execPath, ["test/e2e.js"], { stdio: "inherit" });
test.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
