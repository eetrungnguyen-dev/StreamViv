#!/usr/bin/env bash
# Injects the fake-device harness into a fresh production build and serves it
# on :4173 for the Playwright smoke test.
set -e
cd "$(dirname "$0")/.."
./node_modules/.bin/vite build >/dev/null
python3 - <<'PY'
tpl = open("test/smoke.html.tpl").read()
html = open("dist/index.html").read()
html = html.replace("<body>", "<body>\n" + tpl, 1)
open("dist/__smoke.html", "w").write(html)
print("dist/__smoke.html written")
PY
