#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPEATS="${1:-3}"
TARGET_FILE="test/runtime/loop-shortcuts.test.ts"

if ! [[ "$REPEATS" =~ ^[0-9]+$ ]] || [[ "$REPEATS" -lt 1 ]]; then
  echo "[flake-check] FAIL: repeats must be a positive integer, got: $REPEATS"
  exit 1
fi

echo "[flake-check] start target=${TARGET_FILE} repeats=${REPEATS}"

run_one() {
  local run_index="$1"
  echo "[flake-check] run ${run_index}/${REPEATS}"
  pnpm -s vitest run "$TARGET_FILE"
}

i=1
while [[ "$i" -le "$REPEATS" ]]; do
  run_one "$i"
  i=$((i + 1))
done

echo "[flake-check] PASS (${REPEATS}/${REPEATS} green)"
