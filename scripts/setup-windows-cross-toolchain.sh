#!/usr/bin/env bash
#
# Build the Windows x64 app from Linux, with no root access.
#
# Everything is installed under $HOME. Written for Debian/Ubuntu hosts that
# have *nothing* installed - no gcc, no binutils, no libc headers, no LLVM,
# no NSIS. If you have sudo, `apt install clang lld llvm nsis` plus rustup
# is much less work than this; this script exists for the case where you
# don't.
#
#   ./scripts/setup-windows-cross-toolchain.sh          # install toolchain
#   source ~/.captureviewer-winbuild.env                # load env vars
#   bunx tauri build --target x86_64-pc-windows-msvc --bundles nsis
#
set -euo pipefail

OPT="${OPT:-$HOME/opt}"
ENV_FILE="${ENV_FILE:-$HOME/.captureviewer-winbuild.env}"
ZIG_VERSION="${ZIG_VERSION:-0.15.2}"
LLVM_VERSION="${LLVM_VERSION:-19}"
LLVM_DEB_VERSION="${LLVM_DEB_VERSION:-19.1.7-3+b1}"
NSIS_DEB_VERSION="${NSIS_DEB_VERSION:-3.12-1}"
XWIN_VERSION="${XWIN_VERSION:-0.10.0}"

mkdir -p "$OPT/bin" "$OPT/dl"
step() { printf '\n=== %s ===\n' "$1"; }

# ---------------------------------------------------------------- 1. Rust --
step "Rust toolchain + Windows MSVC target"
if ! [ -x "$HOME/.cargo/bin/rustc" ]; then
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal \
    --default-toolchain stable --no-modify-path
fi
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add x86_64-pc-windows-msvc

# ----------------------------------------------------------------- 2. Zig --
# Cargo must link build scripts and proc-macros *for the host*. With no gcc
# and no libc headers on the box, zig's bundled clang + lld + glibc headers
# are the smallest way to get a working host C toolchain.
step "Zig $ZIG_VERSION (host C toolchain)"
if ! [ -x "$OPT/zig/zig" ]; then
  curl -sSL "https://ziglang.org/download/$ZIG_VERSION/zig-x86_64-linux-$ZIG_VERSION.tar.xz" \
    -o "$OPT/dl/zig.tar.xz"
  tar -C "$OPT" -xf "$OPT/dl/zig.tar.xz"
  rm -rf "$OPT/zig"; mv "$OPT/zig-x86_64-linux-$ZIG_VERSION" "$OPT/zig"
fi
cat > "$OPT/bin/zig-cc" <<EOF
#!/bin/sh
exec $OPT/zig/zig cc "\$@"
EOF
cat > "$OPT/bin/zig-ar" <<EOF
#!/bin/sh
exec $OPT/zig/zig ar "\$@"
EOF
chmod +x "$OPT/bin/zig-cc" "$OPT/bin/zig-ar"

# ------------------------------------------------- 3. MSVC CRT + Win SDK --
# Use the standalone xwin rather than `cargo xwin`: its defaults are
# --arch x86_64 --variant desktop (83 MiB), whereas cargo-xwin also expands
# the arm64 and Store variants, which took hours on a 12-core box.
step "MSVC CRT + Windows SDK via xwin $XWIN_VERSION"
if ! [ -x "$OPT/bin/xwin" ]; then
  curl -sSL -o "$OPT/dl/xwin.tar.gz" \
    "https://github.com/Jake-Shadle/xwin/releases/download/$XWIN_VERSION/xwin-$XWIN_VERSION-x86_64-unknown-linux-musl.tar.gz"
  curl -sSL -o "$OPT/dl/xwin.sha256" \
    "https://github.com/Jake-Shadle/xwin/releases/download/$XWIN_VERSION/xwin-$XWIN_VERSION-x86_64-unknown-linux-musl.tar.gz.sha256"
  # The published .sha256 is a bare digest with no file name, which
  # `sha256sum -c` rejects outright ("no properly formatted checksum lines").
  # Pair the digest with the file name ourselves; taking the first 64
  # characters also copes with the "<digest>  <name>" form.
  xwin_sha="$(tr -d '[:space:]' < "$OPT/dl/xwin.sha256" | cut -c1-64)"
  echo "$xwin_sha  xwin.tar.gz" | (cd "$OPT/dl" && sha256sum -c -)
  tar -C "$OPT/dl" -xzf "$OPT/dl/xwin.tar.gz"
  cp "$OPT/dl/xwin-$XWIN_VERSION-x86_64-unknown-linux-musl/xwin" "$OPT/bin/xwin"
  chmod +x "$OPT/bin/xwin"
fi
if ! [ -f "$OPT/winsdk/sdk/lib/um/x86_64/kernel32.lib" ]; then
  # Microsoft's CDN occasionally returns EAI_AGAIN under xwin's parallel
  # fetches; re-running resumes from the download cache.
  for attempt in 1 2 3; do
    "$OPT/bin/xwin" --accept-license --cache-dir "$HOME/.cache/xwin-clean" \
      splat --output "$OPT/winsdk" && break
    echo "xwin attempt $attempt failed, retrying..."
  done
fi
[ -f "$OPT/winsdk/sdk/lib/um/x86_64/kernel32.lib" ] || { echo "xwin splat incomplete"; exit 1; }

# --------------------------------------- 4. llvm-rc / clang-cl / llvm-lib --
# tauri-build -> tauri-winres -> embed-resource compiles the Windows icon,
# version info and manifest. It requires a real llvm-rc (it sniffs the
# "OVERVIEW: LLVM Resource Converter" banner, so zig rc will not do), and it
# preprocesses the .rc with the *target* C compiler, i.e. clang-cl.
step "llvm-rc / clang-cl / llvm-lib (from Debian .debs, unpacked into \$HOME)"
LLVM_POOL="http://ftp.debian.org/debian/pool/main/l/llvm-toolchain-$LLVM_VERSION"
for p in "llvm-${LLVM_VERSION}_${LLVM_DEB_VERSION}_amd64.deb" \
         "libllvm${LLVM_VERSION}_${LLVM_DEB_VERSION}_amd64.deb" \
         "clang-${LLVM_VERSION}_${LLVM_DEB_VERSION}_amd64.deb" \
         "libclang-cpp${LLVM_VERSION}_${LLVM_DEB_VERSION}_amd64.deb" \
         "libclang-common-${LLVM_VERSION}-dev_${LLVM_DEB_VERSION}_amd64.deb"; do
  [ -f "$OPT/dl/$p" ] || curl -sSL -o "$OPT/dl/$p" "$LLVM_POOL/$p"
  dpkg-deb -x "$OPT/dl/$p" "$OPT/llvm"
done
LLVM_BIN="$OPT/llvm/usr/lib/llvm-$LLVM_VERSION/bin"
# Debian ships no clang-cl symlink; clang picks CL driver mode from argv[0].
ln -sf "clang-$LLVM_VERSION" "$LLVM_BIN/clang-cl"
[ -e "$LLVM_BIN/llvm-lib" ] || ln -sf llvm-ar "$LLVM_BIN/llvm-lib"
for tool in llvm-rc clang-cl llvm-lib; do
  # Delete before writing. On a re-run $OPT/bin/clang-cl is already the
  # symlink created at the end of this block, and `cat >` follows a symlink
  # and truncates its *target* - so it would overwrite the real clang binary
  # with this wrapper. clang would then exec clang-cl, which resolves back to
  # clang, and the kernel reports the exec loop as "Argument list too long".
  rm -f "$OPT/bin/$tool"
  cat > "$OPT/bin/$tool" <<EOF
#!/bin/sh
LD_LIBRARY_PATH="$OPT/llvm/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}" \\
  exec $LLVM_BIN/$tool "\$@"
EOF
  chmod +x "$OPT/bin/$tool"
done
# clang-cl must be a real symlink so argv[0] selects CL mode.
ln -sf "$LLVM_BIN/clang-cl" "$OPT/bin/clang-cl"

# ----------------------------------------------------------- 5. lld-link --
# rustc already passes "-flavor link" for the MSVC target, so this shim must
# forward its arguments untouched - adding another -flavor breaks the link.
step "lld-link shim over the toolchain's rust-lld"
RUST_LLD="$(echo "$HOME"/.rustup/toolchains/*/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld)"
cat > "$OPT/bin/lld-link" <<EOF
#!/bin/sh
exec $RUST_LLD "\$@"
EOF
chmod +x "$OPT/bin/lld-link"

# --------------------------------------------------------------- 6. NSIS --
# Debian's makensis has its data path compiled in as /usr/share/nsis, which
# we cannot create without root - so the wrapper exports NSISDIR itself,
# which works regardless of the environment tauri passes to it.
step "NSIS $NSIS_DEB_VERSION"
NSIS_POOL="http://ftp.debian.org/debian/pool/main/n/nsis"
for p in "nsis_${NSIS_DEB_VERSION}_amd64.deb" \
         "nsis-common_${NSIS_DEB_VERSION}_all.deb" \
         "nsis-pluginapi_${NSIS_DEB_VERSION}_all.deb"; do
  [ -f "$OPT/dl/$p" ] || curl -sSL -o "$OPT/dl/$p" "$NSIS_POOL/$p"
  dpkg-deb -x "$OPT/dl/$p" "$OPT/nsis"
done
cat > "$OPT/bin/makensis" <<EOF
#!/bin/sh
NSISDIR=$OPT/nsis/usr/share/nsis
export NSISDIR
exec $OPT/nsis/usr/bin/makensis "\$@"
EOF
chmod +x "$OPT/bin/makensis"

# ----------------------------------------------------------------- 7. env --
step "Writing $ENV_FILE"
cat > "$ENV_FILE" <<EOF
# Source this before building for Windows.
export PATH="$OPT/bin:\$HOME/.cargo/bin:$OPT/zig:\$PATH"
export LD_LIBRARY_PATH="$OPT/llvm/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"

# Host: link build scripts / proc-macros with zig's bundled clang+lld.
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=zig-cc
export CC_x86_64_unknown_linux_gnu=zig-cc
export AR_x86_64_unknown_linux_gnu=zig-ar

# Target: MSVC ABI, linked by rust-lld, against the xwin-splatted SDK.
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=lld-link
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="-Lnative=$OPT/winsdk/crt/lib/x86_64 -Lnative=$OPT/winsdk/sdk/lib/um/x86_64 -Lnative=$OPT/winsdk/sdk/lib/ucrt/x86_64 -C link-arg=/ignore:4099"
export CC_x86_64_pc_windows_msvc=clang-cl
export CXX_x86_64_pc_windows_msvc=clang-cl
export AR_x86_64_pc_windows_msvc=llvm-lib
export RC_x86_64_pc_windows_msvc=llvm-rc
export INCLUDE="$OPT/winsdk/crt/include;$OPT/winsdk/sdk/include/ucrt;$OPT/winsdk/sdk/include/um;$OPT/winsdk/sdk/include/shared"
export LIB="$OPT/winsdk/crt/lib/x86_64;$OPT/winsdk/sdk/lib/um/x86_64;$OPT/winsdk/sdk/lib/ucrt/x86_64"
EOF

step "Done"
cat <<EOF
Toolchain installed under $OPT.

  source $ENV_FILE
  bunx tauri build --target x86_64-pc-windows-msvc --bundles nsis

Output: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
EOF
