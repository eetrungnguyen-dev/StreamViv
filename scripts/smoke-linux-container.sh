#!/usr/bin/env bash
#
# Prove the Linux bundle actually starts.
#
# Compiling is the easy half. The half that keeps breaking is what happens
# at runtime: whether the declared package dependencies are really enough,
# and whether WebKitGTK comes up with MediaStream enabled. So this installs
# the built .deb into a *clean* Ubuntu 22.04 container - apt resolves the
# dependencies exactly as a user's machine would - starts the app on a
# virtual display and screenshots it.
#
# A screenshot rather than an exit code because that is where the answer
# actually shows up: the app reports "no capture device" when the camera API
# is present but empty (correct for a machine with no card), and "this
# WebKitGTK build exposes no camera API" when the media-stream setting did
# not take. The two failure modes are indistinguishable from a log.
#
#   scripts/build-linux-container.sh && scripts/smoke-linux-container.sh
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${CCV_OUT:-$repo_root/release/linux}"
image="${CCV_LINUX_IMAGE:-docker.io/library/ubuntu:22.04}"

engine="${CCV_ENGINE:-}"
if [ -z "$engine" ]; then
  for candidate in podman docker; do
    if command -v "$candidate" >/dev/null 2>&1; then engine="$candidate"; break; fi
  done
fi
[ -n "$engine" ] || { echo "error: podman or docker is required." >&2; exit 1; }

deb="$(find "$out_dir" -maxdepth 1 -name '*.deb' | head -1)"
if [ -z "$deb" ]; then
  echo "error: no .deb in $out_dir - run scripts/build-linux-container.sh first." >&2
  exit 1
fi
echo "==> testing $(basename "$deb")"

"$engine" run --rm -i \
  -v "$out_dir":/out \
  -e DEBIAN_FRONTEND=noninteractive \
  "$image" bash -s <<'IN_CONTAINER'
set -euo pipefail

echo "==> installing the package (apt resolves the declared dependencies)"
apt-get update -qq
apt-get install -y -qq --no-install-recommends xvfb x11-utils imagemagick dbus-x11 xdotool >/dev/null
deb="$(find /out -maxdepth 1 -name '*.deb' | head -1)"
apt-get install -y -qq "$deb"

echo "==> starting a virtual display"
Xvfb :99 -screen 0 1280x720x24 >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
for _ in $(seq 1 40); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.25; done
xdpyinfo >/dev/null 2>&1 || { echo "error: Xvfb never came up"; cat /tmp/xvfb.log; exit 1; }

# No GPU and no compositor in a container.
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

echo "==> launching the app"
eval "$(dbus-launch --sh-syntax)"
streamviv >/tmp/streamviv.log 2>&1 &
app_pid=$!
sleep 12

if ! kill -0 "$app_pid" 2>/dev/null; then
  echo "FAIL: the app exited on its own"
  cat /tmp/app.log
  exit 1
fi

echo "==> window list"
wmctrl -l 2>/dev/null || xwininfo -root -children | sed -n '4,12p'

echo "==> screenshot"
import -window root /out/linux-smoke.png

# Right-click the middle of the window and shoot again. A native GtkMenu is
# its own X window, so it shows up in a root-window capture - which makes
# this the one place the menu can actually be *seen* rather than merely
# reported as constructed.
echo "==> screenshot with the context menu open"
if command -v xdotool >/dev/null 2>&1; then
  xdotool mousemove 640 360 click 3
  sleep 2
  import -window root /out/linux-smoke-menu.png
  xdotool key Escape
else
  echo "note: xdotool missing, cannot open the menu"
fi
kill "$app_pid" 2>/dev/null || true

echo "==> app output"
cat /tmp/app.log
echo "==> ok: the app stayed up; see release/linux/linux-smoke.png"
IN_CONTAINER
