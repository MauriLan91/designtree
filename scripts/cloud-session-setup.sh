#!/bin/bash
# Prepares a Claude Code cloud session so `cargo test` and `npm run build` work.
# Meant to run as a SessionStart hook (see docs/cloud-sessions.md); safe to run
# again, and a no-op outside cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$(dirname "$0")/.."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# System packages: Tauri on Linux (as in .github/workflows/ci.yml), dtc for the
# round-trip and build tests, gcc for the cpp the G1 corpus calls.
PACKAGES="libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev device-tree-compiler gcc"
if ! dpkg -s $PACKAGES >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq $PACKAGES
fi

# tauri::generate_context! needs the frontend dist directory to exist.
mkdir -p app/dist

# npm install, not ci: the container state is cached after the hook.
(cd app && npm install --no-audit --no-fund --silent)

# Fetch crates now so builds and tests do not wait on the network.
cargo fetch --locked --quiet
