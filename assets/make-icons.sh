#!/usr/bin/env bash
# Generate favicon + PWA/iOS icons from the master logo. Requires ImageMagick 7 (`magick`).
set -euo pipefail
cd "$(dirname "$0")"

SRC=karpathy_ai_logo.png
OUT=icons
mkdir -p "$OUT"

# Trim the source's white margin, clean off-white noise to pure white.
magick "$SRC" -fuzz 10% -trim +repage -fill white -opaque white "$OUT/.trimmed.png"

# icon <size> <content-fraction> <file>: content scaled to fraction of a white square canvas.
icon() {
  local size=$1 frac=$2 file=$3
  local inner
  inner=$(awk "BEGIN{print int($size*$frac)}")
  magick "$OUT/.trimmed.png" -resize "${inner}x${inner}" \
    -background white -gravity center -extent "${size}x${size}" \
    -strip "$OUT/$file"
}

icon 16  0.94 favicon-16x16.png
icon 32  0.94 favicon-32x32.png
icon 48  0.94 favicon-48x48.png
icon 180 0.86 apple-touch-icon.png
icon 192 0.86 icon-192.png
icon 512 0.86 icon-512.png
# Maskable: keep content inside the ~80% safe-zone circle.
icon 512 0.58 icon-maskable-512.png

magick "$OUT/favicon-16x16.png" "$OUT/favicon-32x32.png" "$OUT/favicon-48x48.png" "$OUT/favicon.ico"
rm "$OUT/.trimmed.png"
