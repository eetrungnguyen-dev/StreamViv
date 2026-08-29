#!/usr/bin/env bash
#
# Install everything needed to *build* the viewer on a Linux host, plus the
# GStreamer plugins it needs to *run*.
#
# The two are separate concerns and both are easy to get wrong:
#   * building needs the WebKitGTK 4.1 headers, which are the ABI Tauri 2
#     links against - the older 4.0 packages will not do;
#   * running needs gstreamer1.0-plugins-good, because that is where the
#     v4l2 source lives. Without it WebKitGTK exposes navigator.mediaDevices
#     and then enumerates an empty list, which looks exactly like a broken
#     capture card.
#
#   scripts/setup-linux-deps.sh [--runtime-only]
#
set -euo pipefail

runtime_only=false
[ "${1:-}" = "--runtime-only" ] && runtime_only=true

sudo=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || { echo "error: run as root or install sudo." >&2; exit 1; }
  sudo="sudo"
fi

if command -v apt-get >/dev/null 2>&1; then
  runtime=(libwebkit2gtk-4.1-0 libgtk-3-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good v4l-utils)
  build=(build-essential curl file pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev
         librsvg2-dev libssl-dev libayatana-appindicator3-dev patchelf desktop-file-utils)
  $sudo apt-get update
  if $runtime_only; then $sudo apt-get install -y "${runtime[@]}"
  else $sudo apt-get install -y "${runtime[@]}" "${build[@]}"; fi

elif command -v dnf >/dev/null 2>&1; then
  runtime=(webkit2gtk4.1 gtk3 gstreamer1-plugins-base gstreamer1-plugins-good v4l-utils)
  build=(webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel
         libappindicator-gtk3-devel patchelf desktop-file-utils "@development-tools")
  if $runtime_only; then $sudo dnf install -y "${runtime[@]}"
  else $sudo dnf install -y "${runtime[@]}" "${build[@]}"; fi

elif command -v pacman >/dev/null 2>&1; then
  runtime=(webkit2gtk-4.1 gtk3 gst-plugins-base gst-plugins-good v4l-utils)
  build=(base-devel curl file openssl librsvg patchelf desktop-file-utils)
  if $runtime_only; then $sudo pacman -S --needed --noconfirm "${runtime[@]}"
  else $sudo pacman -S --needed --noconfirm "${runtime[@]}" "${build[@]}"; fi

elif command -v zypper >/dev/null 2>&1; then
  runtime=(libwebkit2gtk-4_1-0 gtk3 gstreamer-plugins-base gstreamer-plugins-good v4l-utils)
  build=(webkit2gtk3-soup2-devel gtk3-devel librsvg-devel libopenssl-devel patchelf)
  if $runtime_only; then $sudo zypper install -y "${runtime[@]}"
  else $sudo zypper install -y "${runtime[@]}" "${build[@]}"; fi

else
  cat >&2 <<'MSG'
error: no supported package manager found (apt, dnf, pacman, zypper).
Install by hand, then re-run scripts/doctor.sh:
  - WebKitGTK 4.1 runtime + headers
  - GTK 3 runtime + headers
  - GStreamer 1.0 base and "good" plugin sets (v4l2 support)
MSG
  exit 1
fi

# Reading /dev/video* needs group membership, and a fresh user account
# usually does not have it. This is the single most common reason the app
# starts and then finds no devices.
if ! id -nG | tr ' ' '\n' | grep -qx video; then
  echo
  echo "note: $USER is not in the 'video' group, so /dev/video* is unreadable."
  echo "      fix with:  sudo usermod -aG video $USER   (then log out and back in)"
fi

echo "done."
