#!/usr/bin/env bash
# Builds Hub.app's AppIcon.icns from the fog photo: cropped square with sips, given
# the rounded macOS icon shape by a tiny Swift script, then packed with iconutil.
#   bash scripts/make-icon.sh <out.icns>
set -euo pipefail

OUT="${1:?usage: make-icon.sh <out.icns>}"
HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHOTO="$HUB_DIR/web/public/photos/fog.jpg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Centre-crop to a square, 1024 px.
side="$(sips -g pixelWidth -g pixelHeight "$PHOTO" \
  | awk '/pixel(Width|Height)/ { if (min == "" || $2 < min) min = $2 } END { print min }')"
sips -s format png -c "$side" "$side" "$PHOTO" --out "$WORK/square.png" >/dev/null
sips -z 1024 1024 "$WORK/square.png" >/dev/null

# Apple's icon grid: an 824 px rounded square (radius 185.4) centred on 1024, with a soft shadow.
cat > "$WORK/mask.swift" <<'SWIFT'
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let input = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
let output = URL(fileURLWithPath: CommandLine.arguments[2]) as CFURL
guard let source = CGImageSourceCreateWithURL(input, nil),
      let photo = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let canvas = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                             space: CGColorSpace(name: CGColorSpace.sRGB)!,
                             bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("can't read \(input)") }

let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 185.4, cornerHeight: 185.4, transform: nil)
canvas.saveGState()
canvas.setShadow(offset: CGSize(width: 0, height: -10), blur: 20, color: CGColor(gray: 0, alpha: 0.35))
canvas.addPath(shape)
canvas.fillPath()
canvas.restoreGState()
canvas.addPath(shape)
canvas.clip()
canvas.draw(photo, in: body)

guard let icon = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithURL(output, UTType.png.identifier as CFString, 1, nil)
else { fatalError("can't write \(output)") }
CGImageDestinationAddImage(destination, icon, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("can't write \(output)") }
SWIFT
swiftc -O "$WORK/mask.swift" -o "$WORK/mask"
"$WORK/mask" "$WORK/square.png" "$WORK/icon.png"

ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT"
