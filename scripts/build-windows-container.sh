#!/usr/bin/env bash
#
# Build the Windows x64 app in a container, from macOS or Linux.
#
# This is Route C (cross-compile from Linux, NSIS installer, no MSI) wrapped
# so it does not have to touch your machine: the toolchain it needs is a
# Rust MSVC target, zig as the host C compiler, the MSVC CRT and Windows SDK
# via xwin, LLVM's llvm-rc/clang-cl, and NSIS - roughly 2 GB that
# scripts/setup-windows-cross-toolchain.sh installs under $HOME.
#
# The base image is Debian, not Ubuntu, and that is deliberate: the setup
# script unpacks LLVM and NSIS straight from the Debian pool, and those
# binaries are linked against a glibc newer than Ubuntu 22.04 ships. The
# builder's libc does not affect the output - the artifact is a PE binary.
#
# A real Windows runner is still the only way to get an MSI; see
# .github/workflows/windows-build.yml.
#
#   scripts/build-windows-container.sh [--shell]
#
# Env:
#   CCV_WINDOWS_IMAGE  base image            (default docker.io/library/debian:13)
#   CCV_ENGINE         podman | docker       (default: whichever is found)
#   CCV_OUT_WIN        host output directory (default: release/windows)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CCV_WINDOWS_IMAGE:-docker.io/library/debian:13}"
out_dir="${CCV_OUT_WIN:-$repo_root/release/windows}"

engine="${CCV_ENGINE:-}"
if [ -z "$engine" ]; then
  for candidate in podman docker; do
    if command -v "$candidate" >/dev/null 2>&1; then engine="$candidate"; break; fi
  done
fi
[ -n "$engine" ] || { echo "error: podman or docker is required." >&2; exit 1; }

# The toolchain is the expensive part (xwin alone downloads ~1 GB from
# Microsoft's CDN), so it is cached outside the container.
#
# It is cached as a *single* mount covering the whole of /root rather than
# one mount per directory, because xwin's `splat` hardlinks the files it
# unpacks out of its download cache into the SDK output directory. With
# ~/.cache and ~/opt on two different bind mounts those are two different
# filesystems and every link fails with EXDEV ("Cross-device link").
cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/streamviv/windows-build"
mkdir -p "$cache_root/home" "$cache_root/target" "$out_dir"

echo "==> engine : $engine"
echo "==> image  : $image"
echo "==> output : $out_dir"
echo "==> cache  : $cache_root"

"$engine" run --rm -i \
  -v "$repo_root":/src:ro \
  -v "$out_dir":/out \
  -v "$cache_root/home":/root \
  -v "$cache_root/target":/build/src-tauri/target \
  -e DEBIAN_FRONTEND=noninteractive \
  -e CARGO_TERM_COLOR=never \
  "$image" bash -s -- "$@" <<'IN_CONTAINER'
set -euo pipefail
mode="${1:-}"

echo "==> installing the few host packages the setup script assumes"
apt-get update -qq
# dpkg-deb and sha256sum are already in the base image; these are not.
#
# The four lib* packages are what the *unpacked* LLVM binaries link against.
# The setup script pulls clang and llvm-rc straight out of Debian .debs into
# $HOME without dpkg, so their dependencies are never resolved - on a real
# desktop install they happen to be present, in a minimal image they are
# not, and llvm-rc then dies with "error while loading shared libraries".
# tauri-winres reads that as an unusable resource compiler and panics with
# "Unknown RC compiler variant: llvm-rc", which is a long way from the cause.
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl xz-utils tar unzip file \
  libedit2 libffi8 libxml2 libz3-4 >/dev/null

echo "==> copying the working tree"
mkdir -p /build
tar -C /src --exclude=node_modules --exclude=src-tauri/target --exclude=release \
    --exclude=.git --exclude=dist -cf - . | tar -C /build -xf -
cd /build

echo "==> installing the cross toolchain (cached between runs)"
bash scripts/setup-windows-cross-toolchain.sh
# shellcheck disable=SC1090
source "$HOME/.captureviewer-winbuild.env"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash >/dev/null
fi
export PATH="/root/.bun/bin:$PATH"

if [ "$mode" = "--shell" ]; then exec bash; fi

echo "==> installing frontend dependencies"
bun install --frozen-lockfile

echo "==> running the unit tests"
bun test test/

echo "==> building the Windows bundle"
bun run tauri build --target x86_64-pc-windows-msvc --bundles nsis

echo "==> collecting artifacts"
rel=src-tauri/target/x86_64-pc-windows-msvc/release
cp -v "$rel/streamviv.exe" /out/
find "$rel/bundle/nsis" -maxdepth 1 -name '*.exe' -exec cp -v {} /out/ \;
echo "==> done"
IN_CONTAINER

echo
echo "Artifacts in $out_dir:"
ls -la "$out_dir"
