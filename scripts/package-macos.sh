#!/usr/bin/env bash
#
# Package the built .app as a distributable .dmg, without Finder.
#
# `tauri build` makes the .dmg by driving Finder over AppleScript to lay the
# disk image window out. That needs a logged-in GUI session: over SSH, in a
# background job or in most CI containers the Apple Event times out and the
# whole build fails *after* the .app has already been produced.
#
# The layout is cosmetic. hdiutil alone makes a perfectly good compressed,
# mountable image with the conventional drag-to-Applications shortcut, and
# it works headlessly.
#
#   scripts/package-macos.sh [path/to/App.app]
#
# Output: release/macos/<name>_<version>_<arch>.dmg  (+ a .zip alongside)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

[ "$(uname -s)" = "Darwin" ] || { echo "error: macOS only." >&2; exit 1; }

app="${1:-}"
if [ -z "$app" ]; then
  app="$(find src-tauri/target -maxdepth 5 -type d -name '*.app' -path '*/bundle/macos/*' \
         -not -path '*/dmg/*' 2>/dev/null | head -1)"
fi
[ -n "$app" ] && [ -d "$app" ] || {
  echo "error: no .app found - run 'bun run tauri build --bundles app' first." >&2
  exit 1
}

name="$(basename "$app" .app)"
plist="$app/Contents/Info.plist"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || echo 0.0.0)"
arch="$(lipo -archs "$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" 2>/dev/null | tr ' ' '-')"
arch="${arch:-$(uname -m)}"

out_dir="$repo_root/release/macos"
mkdir -p "$out_dir"
dmg="$out_dir/${name// /-}_${version}_${arch}.dmg"
zip="$out_dir/${name// /-}_${version}_${arch}.zip"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"

echo "==> app     : $app"
echo "==> version : $version ($arch)"

rm -f "$dmg"
hdiutil create -quiet -volname "$name" -srcfolder "$stage" -ov -format UDZO "$dmg"

# A zipped .app is what most people actually want for a local install, and
# it is the only form that survives a plain HTTP download unsigned.
rm -f "$zip"
( cd "$(dirname "$app")" && ditto -c -k --sequesterRsrc --keepParent "$(basename "$app")" "$zip" )

echo
echo "Packaged:"
ls -lh "$dmg" "$zip"
echo
echo "Install: open the .dmg and drag the app to Applications."
echo "Unsigned build: first launch needs right-click > Open, or"
echo "  xattr -dr com.apple.quarantine '/Applications/$name.app'"
