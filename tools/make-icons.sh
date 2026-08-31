#!/bin/bash
# Regenerate the PWA icons from tools/icon.html through the real browser, at
# the exact pixel sizes the manifest promises. No image toolchain, no npm: the
# icon is drawn by the same engine that will display it.
#
#   bash tools/make-icons.sh          # writes web/icons/*.png
#
# The maskable variant scales the mark to 62% so the whole thing survives a
# launcher that crops to the central circle (the spec's 40%-radius safe zone).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="file://$root/tools/icon.html"
out="$root/web/icons"
mkdir -p "$out"

shoot() { # size, outfile, query
  node "$root/tools/screenshot.js" "$src$3" "$out/$2" \
    --size "$1x$1" --dsf 1 --desktop --wait 350 --quiet
}

shoot 192 icon-192.png ""
shoot 512 icon-512.png ""
shoot 512 icon-maskable-512.png "?safe=0.62"
shoot 180 apple-touch-icon-180.png ""

echo "icons written to $out"
