#!/usr/bin/env bash
# Builds dist/Hub.app, the native macOS window around the hub, with swiftc (no Xcode project).
#   bash scripts/build-app.sh          build and ad-hoc sign dist/Hub.app
#   bash scripts/build-app.sh --test   compile and run the ServerProcess tests
set -euo pipefail

HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$HUB_DIR/.." && pwd)"
SRC="$HUB_DIR/mac/HubApp"
TARGET="$(uname -m)-apple-macos14.0"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ "${1:-}" == "--test" ]]; then
  swiftc -parse-as-library -swift-version 5 -target "$TARGET" \
    "$SRC/ServerProcess.swift" "$SRC/Tests/ServerProcessTests.swift" -o "$WORK/server-process-tests"
  "$WORK/server-process-tests"
  exit
fi

NODE="$(command -v node)" || { echo "node is not on PATH" >&2; exit 1; }
if [[ ! -f "$HUB_DIR/web/dist/index.html" ]]; then
  (cd "$HUB_DIR" && npm run build)
fi

APP="$HUB_DIR/dist/Hub.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -target "$TARGET" -framework AppKit -framework WebKit \
  "$SRC/main.swift" "$SRC/AppDelegate.swift" "$SRC/WebViewController.swift" "$SRC/ServerProcess.swift" \
  -o "$APP/Contents/MacOS/Hub"
cp "$SRC/Info.plist" "$APP/Contents/Info.plist"
bash "$HUB_DIR/scripts/make-icon.sh" "$APP/Contents/Resources/AppIcon.icns"

# Where node and the repo are; ServerProcess reads this to start the server.
node -e 'process.stdout.write(JSON.stringify({ node: process.argv[1], repo: process.argv[2] }, null, 2) + "\n")' \
  "$NODE" "$REPO_DIR" > "$APP/Contents/Resources/hub-paths.json"

cat > "$WORK/Hub.entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.camera</key>
  <true/>
</dict>
</plist>
PLIST
codesign -s - --force --deep --entitlements "$WORK/Hub.entitlements" "$APP"

echo "Built $APP"
