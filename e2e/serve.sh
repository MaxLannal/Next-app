#!/usr/bin/env bash
# One end-to-end hub: a fresh, empty data folder, its own port, and no Mac integrations
# (no Calendar, media keys or caffeinate), so a test run never touches the user's data or prompts.
set -euo pipefail
port="$1"
dir="$(mktemp -d "${TMPDIR:-/tmp}/hub-e2e.XXXXXX")"
printf '{"port":%s}\n' "$port" > "$dir/config.json"
cd "$(dirname "$0")/.."
HUB_DATA_DIR="$dir" HUB_NO_MAC=1 exec node server/main.ts
