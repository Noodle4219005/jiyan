#!/usr/bin/env bash
# Build release artifacts: scripts/release.sh [--skip-checks]
# Steps: checks -> clean build -> AppImage + deb -> SHA256SUMS. It never pushes, tags or uploads anything.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "${1:-}" == "--skip-checks" ]] || scripts/smoke.sh
cd app
ver="$(node -p "require('./package.json').version")"
echo "== Building Jiyan $ver"
rm -rf dist out
npm run dist
cd dist
sha256sum Jiyan-"$ver".AppImage Jiyan-"$ver".deb > SHA256SUMS
echo "== Artifacts in $(pwd)"; ls -lh Jiyan-"$ver".* SHA256SUMS | awk '{print $5, $9}'
echo "Next: test the AppImage on a clean machine (see README), then publish the files + SHA256SUMS."
