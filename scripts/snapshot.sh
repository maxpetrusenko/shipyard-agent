#!/usr/bin/env bash
set -euo pipefail

# Capture point-in-time metrics for a target directory.
# Usage: ./scripts/snapshot.sh <target-dir> <label>
# Example: ./scripts/snapshot.sh /path/to/ship-refactored refactored

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${SHIPYARD_BENCHMARK_RESULTS_DIR:-${SHIPYARD_RESULTS_DIR:-${AGENT_DIR}/results/benchmarks}}"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <target-dir> <label>"
  echo "  e.g. $0 /path/to/original-ship original"
  echo "  e.g. $0 /path/to/ship-refactored refactored"
  exit 1
fi

TARGET="$1"
LABEL="$2"

if [ ! -d "$TARGET" ]; then
  echo "Error: directory not found: $TARGET"
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FNAME="snapshot-${LABEL}-$(date -u +"%Y%m%dT%H%M%S").json"
mkdir -p "$RESULTS_DIR"

echo "=== Shipyard Snapshot: ${LABEL} ==="
echo "Target: ${TARGET}"
echo "Timestamp: ${TIMESTAMP}"
echo ""

# -- Type check --
echo "[1/5] Running type-check..."
TC_STATUS="pass"
TC_ERRORS=0
TC_OUTPUT=""
cd "$TARGET"
if ! TC_OUTPUT=$(pnpm type-check 2>&1); then
  TC_STATUS="fail"
fi
TC_ERRORS=$(echo "$TC_OUTPUT" | grep -c "error TS" || true)
echo "  Typecheck: ${TC_STATUS} (${TC_ERRORS} errors)"

# -- Tests --
echo "[2/5] Running tests..."
TEST_OUTPUT=$(pnpm test 2>&1 || true)
TEST_TOTAL=$(echo "$TEST_OUTPUT" | grep -oE 'Tests[[:space:]]+[0-9]+' | grep -oE '[0-9]+' || echo "0")
TEST_PASSED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")
TEST_FAILED=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")
TEST_TOTAL="${TEST_TOTAL:-0}"
TEST_PASSED="${TEST_PASSED:-0}"
TEST_FAILED="${TEST_FAILED:-0}"
echo "  Tests: ${TEST_PASSED}/${TEST_TOTAL} passed, ${TEST_FAILED} failed"

# -- Security audit --
echo "[3/5] Running security audit..."
AUDIT_VULNS=0
if command -v pnpm &>/dev/null; then
  AUDIT_OUTPUT=$(pnpm audit --json 2>/dev/null || echo '{}')
  AUDIT_VULNS=$(echo "$AUDIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('total',0))" 2>/dev/null || echo "0")
fi
echo "  Vulnerabilities: ${AUDIT_VULNS}"

# -- LOC + file count --
echo "[4/5] Counting source files and lines..."
FILE_COUNT=$(find . \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -not -path '*/node_modules/*' -not -path '*/dist/*' | wc -l | tr -d ' ')
LOC=$(find . \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -not -path '*/node_modules/*' -not -path '*/dist/*' -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')
echo "  Files: ${FILE_COUNT}, LOC: ${LOC}"

# -- Build speed --
echo "[5/5] Measuring build..."
BUILD_MS=0
if [ -f "package.json" ]; then
  BUILD_START=$(python3 -c "import time; print(int(time.time()*1000))")
  if pnpm build 2>&1 >/dev/null; then
    BUILD_END=$(python3 -c "import time; print(int(time.time()*1000))")
    BUILD_MS=$((BUILD_END - BUILD_START))
  fi
fi
echo "  Build: ${BUILD_MS}ms"

# -- Write JSON --
cd "$AGENT_DIR"

# Sanitize to clean integers
sanitize() { echo "${1:-0}" | grep -oE '[0-9]+' | tail -1 || echo "0"; }

TC_ERRORS=$(sanitize "$TC_ERRORS")
TEST_TOTAL=$(sanitize "$TEST_TOTAL")
TEST_PASSED=$(sanitize "$TEST_PASSED")
TEST_FAILED=$(sanitize "$TEST_FAILED")
AUDIT_VULNS=$(sanitize "$AUDIT_VULNS")
FILE_COUNT=$(sanitize "$FILE_COUNT")
LOC=$(sanitize "$LOC")
BUILD_MS=$(sanitize "$BUILD_MS")

jq -n \
  --arg type "snapshot" \
  --arg label "$LABEL" \
  --arg timestamp "$TIMESTAMP" \
  --arg path "$TARGET" \
  --arg tcStatus "$TC_STATUS" \
  --argjson tcErrors "$TC_ERRORS" \
  --argjson testTotal "$TEST_TOTAL" \
  --argjson testPassed "$TEST_PASSED" \
  --argjson testFailed "$TEST_FAILED" \
  --argjson vulns "$AUDIT_VULNS" \
  --argjson loc "$LOC" \
  --argjson files "$FILE_COUNT" \
  --argjson buildMs "$BUILD_MS" \
  '{
    type: $type,
    label: $label,
    timestamp: $timestamp,
    path: $path,
    typecheck: { status: $tcStatus, errors: $tcErrors },
    tests: { total: $testTotal, passed: $testPassed, failed: $testFailed },
    security: { vulnerabilities: $vulns },
    loc: $loc,
    files: $files,
    buildDurationMs: $buildMs
  }' > "${RESULTS_DIR}/${FNAME}"

echo ""
echo "=== Snapshot Complete ==="
echo "Result: ${RESULTS_DIR}/${FNAME}"
echo "Typecheck: ${TC_STATUS} (${TC_ERRORS} errors)"
echo "Tests: ${TEST_PASSED}/${TEST_TOTAL} passed"
echo "Security: ${AUDIT_VULNS} vulnerabilities"
echo "LOC: ${LOC} across ${FILE_COUNT} files"
echo "Build: ${BUILD_MS}ms"
