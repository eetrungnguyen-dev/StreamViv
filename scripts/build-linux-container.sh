#!/usr/bin/env bash
#
# Build the Linux bundles (.deb, .rpm, AppImage) inside a container.
#
# Why a container rather than the host:
#   * the build needs libwebkit2gtk-4.1-dev, GTK and a Rust toolchain, which
#     is a lot of root-owned packages to ask of a machine that only wants to
#     *run* the viewer;
#   * glibc is backwards compatible but not forwards compatible, so a bundle
#     built on a rolling distribution refuses to start on an LTS one. Ubuntu
#     22.04 is old enough to cover everything still receiving updates and
#     new enough to carry the 4.1 webkit ABI Tauri 2 links against.
#
# The repository is copied into the container instead of being built in
# place, so a Linux `node_modules` (esbuild ships a per-platform binary)
# never overwrites the host's.
#
#   scripts/build-linux-container.sh [--shell]
#
# Env:
#   CCV_LINUX_IMAGE   base image           (default docker.io/library/ubuntu:22.04)
#   CCV_ENGINE        podman | docker      (default: whichever is found)
#   CCV_OUT           host output directory (default: release/linux)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CCV_LINUX_IMAGE:-docker.io/library/ubuntu:22.04}"
out_dir="${CCV_OUT:-$repo_root/release/linux}"

engine="${CCV_ENGINE:-}"
if [ -z "$engine" ]; then
  for candidate in podman docker; do
    if command -v "$candidate" >/dev/null 2>&1; then engine="$candidate"; break; fi
  done
fi
if [ -z "$engine" ]; then
  echo "error: neither podman nor docker is installed." >&2
  echo "       On the host you can instead run: scripts/setup-linux-deps.sh && bun run app:build" >&2
  exit 1
fi

# Persisted between runs so a rebuild is minutes rather than tens of minutes.
cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/streamviv/linux-build"
mkdir -p "$cache_root/cargo-registry" "$cache_root/cargo-target" "$out_dir"

echo "==> engine   : $engine"
echo "==> image    : $image"
echo "==> output   : $out_dir"
echo "==> cache    : $cache_root"

"$engine" run --rm -i \
  -v "$repo_root":/src:ro \
  -v "$out_dir":/out \
  -v "$cache_root/cargo-registry":/root/.cargo/registry \
  -v "$cache_root/cargo-target":/build/src-tauri/target \
  -e DEBIAN_FRONTEND=noninteractive \
  -e CARGO_TERM_COLOR=never \
  "$image" bash -s -- "$@" <<'IN_CONTAINER'
set -euo pipefail
mode="${1:-}"

echo "==> installing build dependencies"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  build-essential ca-certificates curl file pkg-config unzip \
  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev \
  libayatana-appindicator3-dev patchelf desktop-file-utils >/dev/null

echo "==> installing toolchains"
curl -fsSL --proto '=https' --tlsv1.2 https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path >/dev/null
export PATH="/root/.cargo/bin:/root/.bun/bin:$PATH"
curl -fsSL https://bun.sh/install | bash >/dev/null
rustc --version
bun --version

echo "==> copying the working tree"
mkdir -p /build
# node_modules and target are per-platform and are rebuilt/cached inside.
tar -C /src --exclude=node_modules --exclude=src-tauri/target --exclude=release \
    --exclude=.git --exclude=dist -cf - . | tar -C /build -xf -
cd /build

if [ "$mode" = "--shell" ]; then exec bash; fi

echo "==> installing frontend dependencies"
bun install --frozen-lockfile

echo "==> running the unit tests"
bun test test/

echo "==> building the bundles"
bun run tauri build

echo "==> collecting artifacts"
bundle=src-tauri/target/release/bundle
find "$bundle" -maxdepth 2 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
  -exec cp -v {} /out/ \;
cp -v src-tauri/target/release/streamviv /out/streamviv
echo "==> done"
IN_CONTAINER

echo
echo "Artifacts in $out_dir:"
ls -la "$out_dir"
