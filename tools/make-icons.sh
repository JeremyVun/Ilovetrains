#!/bin/bash
# Regenerate platform icons from assets/brand/sleepers.svg and its locked
# opaque 1024px master. No image toolchain or npm dependency is required.
#
#   bash tools/make-icons.sh
#
# Android and the PWA maskable icon scale the mark to 62% so the whole drawing
# survives adaptive launcher crops.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="file://$root/tools/icon.html"
web_out="$root/web/icons"
ios_out="$root/ios/ILoveTrains/Resources/Assets.xcassets/AppIcon.appiconset/icon.png"
android_out="$root/android/app/src/main/res/drawable-nodpi/ic_launcher.png"
expected_svg="b9103abffe50f8a43f89dec7722ff6b1bf164453f0bef9513bf6888a14a85774"
expected_png="4b21719de7dbb39e7398aed436215530a131925223d9ab77b71b85069ce7c218"
mkdir -p "$web_out"

[[ "$(shasum -a 256 "$root/assets/brand/sleepers.svg" | awk '{print $1}')" == "$expected_svg" ]] || { echo "sleepers.svg is not the locked source" >&2; exit 1; }
[[ "$(shasum -a 256 "$root/assets/brand/sleepers-1024.png" | awk '{print $1}')" == "$expected_png" ]] || { echo "sleepers-1024.png is not the locked source" >&2; exit 1; }

shoot() { # size, outfile, query
  node "$root/tools/screenshot.js" "$src$3" "$2" \
    --size "$1x$1" --dsf 1 --desktop --wait 350 --quiet \
    --eval "document.documentElement.dataset.iconReady === 'true' || (() => { throw new Error('icon did not render') })()"
}

shoot 192 "$web_out/icon-192.png" ""
shoot 512 "$web_out/icon-512.png" ""
shoot 512 "$web_out/icon-maskable-512.png" "?safe=0.62"
shoot 180 "$web_out/apple-touch-icon-180.png" ""
cp "$root/assets/brand/sleepers-1024.png" "$ios_out"
shoot 512 "$android_out" "?safe=0.62"

echo "icons written to web, iOS and Android asset entry points"
