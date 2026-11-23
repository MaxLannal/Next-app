#!/usr/bin/env bash
# Compiles every Swift helper in mac/<name>-helper/ into mac/bin/<name>-helper,
# embeds the helper's Info.plist when it has one (macOS reads the permission
# prompts from it), and ad-hoc signs the result. Run from anywhere:
#   bash scripts/build-helpers.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/mac/bin"

# The frameworks each helper links. Add a line here when you add a helper.
frameworks_for() {
  case "$1" in
    calendar-helper) echo "EventKit" ;;
    *) echo "" ;;
  esac
}

built=0
for dir in "$root"/mac/*-helper; do
  [ -f "$dir/main.swift" ] || continue
  name="$(basename "$dir")"
  out="$root/mac/bin/$name"

  args=(-O)
  for framework in $(frameworks_for "$name"); do
    args+=(-framework "$framework")
  done
  args+=(main.swift -o "../bin/$name")
  if [ -f "$dir/Info.plist" ]; then
    args+=(-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist)
  fi

  echo "Building $name"
  (cd "$dir" && swiftc "${args[@]}")
  codesign -s - --force "$out"
  built=$((built + 1))
done

echo "Built $built helper(s) into mac/bin"
