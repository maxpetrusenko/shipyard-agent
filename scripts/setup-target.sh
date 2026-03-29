#!/usr/bin/env bash
set -euo pipefail

TARGET="${SHIPYARD_TARGET:-/Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored}"

if ! git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: $TARGET is not a git repo. Run Phase 2 setup first."
  exit 1
fi

cd "$TARGET"
git checkout .
git clean -fd

# Rebuild shared/dist (gitignored, needed for workspace resolution)
echo "Rebuilding shared types..."
cd shared && npx tsc -b --force && cd ..

echo "ship-refactored reset to baseline."
