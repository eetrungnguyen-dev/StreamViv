#!/usr/bin/env bash
#
# Check that this machine can build - and run - the viewer.
#
# Every check prints what to do about a failure, because the interesting
# problems here are environmental (a missing GStreamer plugin, a user who is
# not in the video group, Xcode command line tools that were never
# installed) rather than anything in the source tree.
#
#   scripts/doctor.sh
#
set -uo pipefail

ok=0; warn=0; bad=0
pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; ok=$((ok+1)); }
note() { printf '  \033[33mnote\033[0m  %s\n' "$1"; warn=$((warn+1)); }
fail() { printf '  \033[31mmiss\033[0m  %s\n' "$1"; bad=$((bad+1)); }

have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux)  os=linux ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) os=unknown ;;
esac
echo "streamviv doctor - host: $os ($(uname -m))"
echo
echo "toolchain"

if have bun; then pass "bun $(bun --version)"
elif have node; then note "bun not found, but node $(node --version) can run the build (npm run build)"
else fail "no bun and no node - install bun: curl -fsSL https://bun.sh/install | bash"; fi

if have cargo; then pass "cargo $(cargo --version | awk '{print $2}')"
else fail "cargo not found - install rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; fi

echo
echo "system"

case "$os" in
  macos)
    if xcode-select -p >/dev/null 2>&1; then pass "command line tools at $(xcode-select -p)"
    else fail "command line tools missing - run: xcode-select --install"; fi

    if [ -f src-tauri/Info.plist ] && grep -q NSCameraUsageDescription src-tauri/Info.plist; then
      pass "Info.plist declares NSCameraUsageDescription"
    else
      fail "src-tauri/Info.plist has no NSCameraUsageDescription - macOS will kill the app on first camera access"
    fi

    # Nothing can be granted from a script; point at the panel instead.
    note "camera access is granted per app in System Settings > Privacy & Security > Camera"
    ;;

  linux)
    if have pkg-config && pkg-config --exists webkit2gtk-4.1; then
      pass "webkit2gtk-4.1 $(pkg-config --modversion webkit2gtk-4.1)"
    else
      fail "webkit2gtk-4.1 development files missing - run: scripts/setup-linux-deps.sh"
    fi

    if have pkg-config && pkg-config --exists gtk+-3.0; then
      pass "gtk+-3.0 $(pkg-config --modversion gtk+-3.0)"
    else
      fail "gtk+-3.0 development files missing - run: scripts/setup-linux-deps.sh"
    fi

    # The v4l2 element is what actually opens the capture card.
    if have gst-inspect-1.0; then
      if gst-inspect-1.0 v4l2src >/dev/null 2>&1; then pass "gstreamer v4l2src plugin present"
      else fail "gstreamer v4l2src missing - install gstreamer1.0-plugins-good"; fi
    else
      note "gst-inspect-1.0 not installed; cannot confirm the v4l2 plugin is present"
    fi

    shopt -s nullglob
    nodes=(/dev/video*)
    shopt -u nullglob
    if [ ${#nodes[@]} -gt 0 ]; then pass "capture nodes: ${nodes[*]}"
    else note "no /dev/video* nodes - plug the capture card in before starting the app"; fi

    if id -nG | tr ' ' '\n' | grep -qx video; then pass "$USER is in the 'video' group"
    else fail "$USER is not in the 'video' group - run: sudo usermod -aG video $USER, then re-login"; fi

    if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then pass "wayland session"
    elif [ -n "${DISPLAY:-}" ]; then pass "x11 session on $DISPLAY"
    else note "no DISPLAY/WAYLAND_DISPLAY - a desktop session is required to run the app"; fi
    ;;

  windows)
    note "WebView2 is part of Windows 11 and current Windows 10; the installer bundles it otherwise"
    ;;
esac

echo
printf 'summary: %d ok, %d note, %d missing\n' "$ok" "$warn" "$bad"
[ "$bad" -eq 0 ] || exit 1
