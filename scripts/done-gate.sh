#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_TESTS=(
  "test/server/routes.test.ts"
  "test/server/dashboard.test.ts"
)
TEST_BASELINE=226

echo "[done-gate] start"

# --- 1. Verify required test files exist ---
echo "[done-gate] checking required test files"
for f in "${REQUIRED_TESTS[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "[done-gate] FAIL: missing required test file: $f"
    exit 1
  fi
  echo "  ok: $f"
done

# --- 2. Type-check ---
echo "[done-gate] running: pnpm type-check"
pnpm -s type-check

# --- 3. Full test suite (with count check) ---
echo "[done-gate] running: pnpm test"
TEST_OUTPUT=$(pnpm -s test 2>&1) || { echo "$TEST_OUTPUT"; exit 1; }
echo "$TEST_OUTPUT"

# Extract test count from vitest output — strip ANSI codes first
CLEAN_OUTPUT=$(echo "$TEST_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')
TEST_COUNT=$(echo "$CLEAN_OUTPUT" | grep -oE 'Tests[[:space:]]+[0-9]+' | grep -oE '[0-9]+' || echo "0")
echo "[done-gate] test count: ${TEST_COUNT} (baseline: ${TEST_BASELINE})"

if [[ "$TEST_COUNT" -lt "$TEST_BASELINE" ]]; then
  echo "[done-gate] FAIL: test count ${TEST_COUNT} below baseline ${TEST_BASELINE}"
  exit 1
fi

# --- 4. Flake check on previously unstable suite ---
echo "[done-gate] running flake check"
./scripts/flake-check.sh 3

echo "[done-gate] PASS (${TEST_COUNT} tests)"
