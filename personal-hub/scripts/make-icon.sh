#!/usr/bin/env bash
# Builds Next.app's AppIcon.icns from the logo drawn in scripts/app-icon.ts: written out as SVG by
# node, rasterised at 1024 px by sips, given its soft drop shadow by a tiny Swift script, then
# packed with iconutil.
#   bash scripts/make-icon.sh <out.icns>
set -euo pipefail

OUT="${1:?usage: make-icon.sh <out.icns>}"
HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${NODE:-$(command -v node)}" || { echo "node is not on PATH" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

"$NODE" "$HUB_DIR/scripts/app-icon.ts" > "$WORK/icon.svg"
sips -s format png "$WORK/icon.svg" --out "$WORK/art.png" >/dev/null

# Apple's icon grid leaves room round the tile for a soft shadow, cast here from the art's own shape.
cat > "$WORK/shadow.swift" <<'SWIFT'
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let input = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
let output = URL(fileURLWithPath: CommandLine.arguments[2]) as CFURL
guard let source = CGImageSourceCreateWithURL(input, nil),
      let art = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let canvas = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                             space: CGColorSpace(name: CGColorSpace.sRGB)!,
                             bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("can't read \(input)") }

canvas.setShadow(offset: CGSize(width: 0, height: -10), blur: 20, color: CGColor(gray: 0, alpha: 0.35))
canvas.draw(art, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))

guard let icon = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithURL(output, UTType.png.identifier as CFString, 1, nil)
else { fatalError("can't write \(output)") }
CGImageDestinationAddImage(destination, icon, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("can't write \(output)") }
SWIFT
swiftc -O "$WORK/shadow.swift" -o "$WORK/shadow"
"$WORK/shadow" "$WORK/art.png" "$WORK/icon.png"

ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT"
