# Building and running StreamViv

The viewer is one Svelte frontend inside a Tauri 2 shell. The frontend is
identical everywhere; what differs per platform is how the webview is
allowed to open a capture card, and that is what most of this document is
about.

| Host | Webview | What it takes to see a picture |
| --- | --- | --- |
| macOS | WKWebView | A camera usage description in the binary. wry grants the capture permission itself. |
| Linux | WebKitGTK | `enable-media-stream` switched on **and** the `permission-request` signal answered. Plus GStreamer's v4l2 plugin. |
| Windows | WebView2 | Nothing. |

The first two are handled by `src-tauri/src/platform.rs` and
`src-tauri/build.rs`; the details are in the comments there.

The title bar is shown by default and can be shown or hidden at runtime from
the context menu or with `D`. Fullscreen temporarily restores decorations on
Windows for a reliable transition, then restores the user's preference. The
bundled icons are generated from the 512×512 master image and include
platform-specific sizes up to 256×256 so taskbar and dock rendering stays
sharp.

---

## Common prerequisites

* **Bun** (or Node 18+) - `curl -fsSL https://bun.sh/install | bash`
* **Rust, stable** - `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

Then, from the repository root:

```sh
bun install
bun run doctor      # checks this machine and says what is missing
```

`scripts/doctor.sh` is the fastest way to find out why a build or a capture
card is not working; run it first when something is wrong.

---

## macOS

Requires macOS 11 or newer and the command line tools (`xcode-select
--install`). No Xcode installation is needed.

```sh
bun run app:dev              # development, hot reload
bun run app:build            # .app + .dmg for this machine's architecture
bun run app:build:universal  # one bundle for Apple Silicon and Intel
```

Bundles land in `src-tauri/target/release/bundle/` (`macos/` and `dmg/`).

**The `.dmg` step needs a logged-in GUI session.** Tauri's `bundle_dmg.sh`
drives Finder over AppleScript to lay the disk image window out, and Apple
Events time out over SSH or in a headless job - the `.app` is produced and
then the DMG fails. When there is no desktop session to talk to, build the
app bundle and package it separately:

```sh
bun run tauri build --bundles app
bun run package:macos
```

`scripts/package-macos.sh` builds the image with `hdiutil` alone, so it
works headlessly. It writes both a `.dmg` (with the usual
drag-to-Applications shortcut) and a `.zip` of the `.app` into
`release/macos/`. The window layout is the only thing lost.

GitHub's macOS runners have a session, so CI produces Tauri's own DMG
normally.

**An unsigned build is quarantined on first launch.** Right-click > Open,
or clear the flag:

```sh
xattr -dr com.apple.quarantine "/Applications/StreamViv.app"
```

**Camera permission.** The first launch raises the standard macOS prompt.
If it is dismissed, or the app was replaced by a rebuild, grant it again in
*System Settings > Privacy & Security > Camera* and **restart the app** -
macOS only re-reads the decision at launch.

`tauri dev` runs an unbundled binary that has no `Info.plist`, and macOS
terminates such a process the moment it touches the camera. `build.rs`
therefore links `src-tauri/Info.plist` into the binary's
`__TEXT,__info_plist` section so the development build behaves like the
packaged one. If you ever see the app vanish without an error message on
the first frame, that section is missing:

```sh
otool -s __TEXT __info_plist src-tauri/target/release/streamviv | head -3
```

**Signing** is optional for local use; an unsigned build works after the
usual right-click > Open. For distribution, set `APPLE_SIGNING_IDENTITY`
(and the notarisation variables) before `bun run app:build` -
`src-tauri/entitlements.plist` already requests the camera and microphone
entitlements the hardened runtime needs.

---

## Linux

Requires WebKitGTK **4.1** (not 4.0) and GTK 3.

```sh
scripts/setup-linux-deps.sh   # apt, dnf, pacman and zypper are handled
bun run app:dev
bun run app:build             # .deb, .rpm and .AppImage
```

Two runtime requirements are easy to miss and both look like a broken
capture card:

* **GStreamer's v4l2 plugin.** WebKitGTK reaches capture devices through
  GStreamer. Without `gstreamer1.0-plugins-good` the device list is simply
  empty. The `.deb`/`.rpm` declare it as a dependency and the AppImage
  bundles it (`bundleMediaFramework`), so this mainly bites when running
  from `bun run app:dev`.
* **The `video` group.** `/dev/video*` is not world-readable on most
  distributions:

  ```sh
  sudo usermod -aG video "$USER"   # then log out and back in
  ```

**Blank window on NVIDIA + X11.** WebKitGTK 2.42+ renders through a DMA-BUF
buffer the proprietary driver cannot import. The app detects that exact
combination and disables it; to force the workaround on any machine:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./streamviv
```

### Building Linux bundles from macOS (or on a host you would rather not
touch)

```sh
bun run app:build:linux-container
```

This copies the working tree into an Ubuntu 22.04 container (podman or
docker), builds there and drops the `.deb`, `.rpm` and `.AppImage` into
`release/linux/`. Building on 22.04 rather than a rolling release is
deliberate: glibc is backwards compatible but not forwards compatible, so
a bundle built on a newer distribution will not start on an older one.

Cross-compiling Linux binaries from macOS directly is *not* supported -
webkit2gtk-sys needs the real headers and a GTK sysroot.

---

## Windows

Behaviour is unchanged. A real Windows runner is still the only way to get
an MSI, and `.github/workflows/windows-build.yml` produces it.

To check a change has not broken Windows without owning a Windows machine:

```sh
bun run app:build:windows-container
```

That wraps `scripts/setup-windows-cross-toolchain.sh` (Route C: Rust's MSVC
target, zig as the host C compiler, the MSVC CRT and Windows SDK via xwin,
LLVM's `llvm-rc`/`clang-cl`, and NSIS) in a Debian container and drops
`streamviv.exe` plus the NSIS setup into `release/windows/`. The
toolchain is ~2 GB and is cached between runs; the first build is slow.

Debian rather than Ubuntu is deliberate - the setup script unpacks LLVM and
NSIS from the Debian pool, and those binaries need a newer glibc than Ubuntu
22.04 has. The builder's libc does not reach the artifact.

---

## Android

Needs the Android SDK, NDK 27 (`sdkmanager "ndk;27.2.12479018"`), JDK 17 and
`rustup target add aarch64-linux-android`. Then:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=~/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
bun tauri android build --apk --target aarch64
```

The APK comes out unsigned; zipalign and `apksigner sign` it before
installing. arm64 only, which covers every current phone.

Video does not go through getUserMedia on Android: the System WebView only
sees cameras Camera2 exposes, and most phones expose no USB ones. The card is
opened natively over the USB host API (UVCAndroid: libusb + libuvc) and drawn
in a TextureView behind the transparent page - see `UvcBridge.kt` and
`src/lib/uvc.js`. Its native libs are 4 KB page aligned, so a 16 KB-page
kernel runs the app in Android's compatibility mode. Audio still uses
getUserMedia.

The launcher icon is an adaptive icon generated from `src-tauri/icons/icon.png`
(needs Pillow): `python3 scripts/make-android-icon.py src-tauri/icons/icon.png
src-tauri/gen/android/app/src/main/res preview.png`.

---

## Tests

```sh
bun run test        # node --test; works under Node and under Bun
bun run test:bun    # the same files through Bun's own runner
bun run test:e2e    # production bundle in a headless Chromium
```

The suite is deliberately runner-agnostic: `test/harness.js` implements the
handful of `expect(...)` matchers on top of `node:assert`, so a contributor
with only Node installed can still run everything.

`test/platform.test.js` covers all three platforms from any one of them -
both `detectPlatform()` and `matchBinding()` take the platform as an
argument for exactly that reason.

## Continuous integration

* `.github/workflows/desktop-build.yml` - macOS (universal) and Linux
  (x86_64), on tag or manual dispatch.
* `.github/workflows/windows-build.yml` - Windows x64.
