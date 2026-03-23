#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/bench.sh <instruction-name>
# Example: ./scripts/bench.sh 01-strict-typescript

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="/Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored"
PORT="${SHIPYARD_PORT:-4200}"
BASE_URL="http://localhost:${PORT}/api"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <instruction-name>"
  echo "  e.g. $0 01-strict-typescript"
  exit 1
fi

BENCH_NAME="$1"
INSTRUCTION_FILE="${AGENT_DIR}/instructions/${BENCH_NAME}.md"

if [ ! -f "$INSTRUCTION_FILE" ]; then
  echo "Error: instruction file not found: $INSTRUCTION_FILE"
  exit 1
fi

INSTRUCTION=$(cat "$INSTRUCTION_FILE")
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%S")
BENCH_ID="bench-${BENCH_NAME}-${TIMESTAMP}"
RESULTS_DIR="${AGENT_DIR}/results"
RESULT_FILE="${RESULTS_DIR}/${BENCH_ID}.json"

mkdir -p "$RESULTS_DIR"

echo "=== Shipyard Benchmark: ${BENCH_NAME} ==="
echo "Timestamp: ${TIMESTAMP}"
echo ""

# Step 1: Reset target to baseline
echo "[1/8] Resetting ship-refactored to baseline..."
"${SCRIPT_DIR}/setup-target.sh"

# Step 2: Capture baseline metrics
echo "[2/8] Capturing baseline type-check + test..."
cd "$TARGET"

BASELINE_TYPECHECK="pass"
if ! pnpm type-check > /dev/null 2>&1; then
  BASELINE_TYPECHECK="fail"
fi

BASELINE_TEST_OUTPUT=$(pnpm test 2>&1 || true)
BASELINE_TOTAL=$(echo "$BASELINE_TEST_OUTPUT" | grep -oE '[0-9]+ tests' | grep -oE '[0-9]+' || echo "0")
BASELINE_PASSED=$(echo "$BASELINE_TEST_OUTPUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")

echo "  Baseline: typecheck=${BASELINE_TYPECHECK}, tests=${BASELINE_TOTAL} total / ${BASELINE_PASSED} passed"

# Step 3: Start Shipyard server in background
echo "[3/8] Starting Shipyard server..."
cd "$AGENT_DIR"

# Load .env
set -a
source .env 2>/dev/null || true
set +a

npx tsx src/index.ts &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# Step 4: Wait for health
echo "[4/8] Waiting for server health..."
for i in $(seq 1 30); do
  if curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then
    echo "  Server ready (attempt ${i})"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  Error: server failed to start after 30 attempts"
    exit 1
  fi
  sleep 1
done

# Step 5: Submit instruction
echo "[5/8] Submitting instruction: ${BENCH_NAME}"

# Try to read CLAUDE.md from target for context injection
CLAUDE_MD=""
if [ -f "${TARGET}/.claude/CLAUDE.md" ]; then
  CLAUDE_MD=$(cat "${TARGET}/.claude/CLAUDE.md" | jq -Rs .)
elif [ -f "${TARGET}/CLAUDE.md" ]; then
  CLAUDE_MD=$(cat "${TARGET}/CLAUDE.md" | jq -Rs .)
fi

# Build request body
if [ -n "$CLAUDE_MD" ]; then
  REQUEST_BODY=$(jq -n \
    --arg instruction "$INSTRUCTION" \
    --argjson claudemd "$CLAUDE_MD" \
    '{
      instruction: $instruction,
      contexts: [{
        label: "CLAUDE.md",
        content: $claudemd,
        source: "system"
      }]
    }')
else
  REQUEST_BODY=$(jq -n \
    --arg instruction "$INSTRUCTION" \
    '{ instruction: $instruction }')
fi

START_TIME=$(date +%s)

SUBMIT_RESPONSE=$(curl -sf -X POST "${BASE_URL}/run" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY")

RUN_ID=$(echo "$SUBMIT_RESPONSE" | jq -r '.runId')
echo "  Run ID: ${RUN_ID}"

# Step 6: Poll until done
echo "[6/8] Polling run status..."
PHASE="planning"
while [ "$PHASE" != "done" ] && [ "$PHASE" != "error" ]; do
  sleep 5
  RUN_RESPONSE=$(curl -sf "${BASE_URL}/runs/${RUN_ID}" || echo '{"phase":"polling"}')
  PHASE=$(echo "$RUN_RESPONSE" | jq -r '.phase // "polling"')
  echo "  Phase: ${PHASE}"
done

END_TIME=$(date +%s)
DURATION_MS=$(( (END_TIME - START_TIME) * 1000 ))

# Extract run data
TOKEN_INPUT=$(echo "$RUN_RESPONSE" | jq '.tokenUsage.input // 0')
TOKEN_OUTPUT=$(echo "$RUN_RESPONSE" | jq '.tokenUsage.output // 0')
TRACE_URL=$(echo "$RUN_RESPONSE" | jq -r '.traceUrl // "none"')
ERROR_MSG=$(echo "$RUN_RESPONSE" | jq -r '.error // null')

# Step 7: Run post-bench verification
echo "[7/8] Running post-bench verification in ship-refactored..."
cd "$TARGET"

AFTER_TYPECHECK="pass"
TC_OUTPUT=""
if ! TC_OUTPUT=$(pnpm type-check 2>&1); then
  AFTER_TYPECHECK="fail"
fi
TC_ERRORS=$(echo "$TC_OUTPUT" | grep -c "error TS" || echo "0")

AFTER_TEST_OUTPUT=$(pnpm test 2>&1 || true)
AFTER_TOTAL=$(echo "$AFTER_TEST_OUTPUT" | grep -oE '[0-9]+ tests' | grep -oE '[0-9]+' || echo "0")
AFTER_PASSED=$(echo "$AFTER_TEST_OUTPUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")
AFTER_FAILED=$(echo "$AFTER_TEST_OUTPUT" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")

# Step 8: Collect diff stats
echo "[8/8] Collecting diff stats..."
DIFF_STAT=$(git diff --stat)
DIFF_SHORTSTAT=$(git diff --shortstat)
FILES_CHANGED=$(echo "$DIFF_SHORTSTAT" | grep -oE '[0-9]+ file' | grep -oE '[0-9]+' || echo "0")
LINES_ADDED=$(echo "$DIFF_SHORTSTAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
LINES_REMOVED=$(echo "$DIFF_SHORTSTAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")

# Estimate cost (Opus: $15/M input, $75/M output; Sonnet: $3/M input, $15/M output)
# Rough average assuming mix
COST=$(echo "scale=2; ($TOKEN_INPUT * 0.000009 + $TOKEN_OUTPUT * 0.000045)" | bc 2>/dev/null || echo "0")

# Write result JSON
jq -n \
  --arg benchId "$BENCH_ID" \
  --arg instruction "$BENCH_NAME" \
  --arg startedAt "$(date -u -r $START_TIME +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg completedAt "$(date -u -r $END_TIME +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson durationMs "$DURATION_MS" \
  --arg phase "$PHASE" \
  --argjson tokenInput "$TOKEN_INPUT" \
  --argjson tokenOutput "$TOKEN_OUTPUT" \
  --arg estimatedCost "\$${COST}" \
  --arg traceUrl "$TRACE_URL" \
  --argjson filesChanged "${FILES_CHANGED:-0}" \
  --argjson linesAdded "${LINES_ADDED:-0}" \
  --argjson linesRemoved "${LINES_REMOVED:-0}" \
  --arg baselineTypecheck "$BASELINE_TYPECHECK" \
  --arg afterTypecheck "$AFTER_TYPECHECK" \
  --argjson tcErrors "${TC_ERRORS:-0}" \
  --argjson baselineTotal "${BASELINE_TOTAL:-0}" \
  --argjson baselinePassed "${BASELINE_PASSED:-0}" \
  --argjson afterTotal "${AFTER_TOTAL:-0}" \
  --argjson afterPassed "${AFTER_PASSED:-0}" \
  --argjson afterFailed "${AFTER_FAILED:-0}" \
  --arg error "$ERROR_MSG" \
  --arg diffStat "$DIFF_STAT" \
  '{
    benchId: $benchId,
    instruction: $instruction,
    startedAt: $startedAt,
    completedAt: $completedAt,
    durationMs: $durationMs,
    phase: $phase,
    tokenUsage: { input: $tokenInput, output: $tokenOutput },
    estimatedCost: $estimatedCost,
    traceUrl: $traceUrl,
    filesChanged: $filesChanged,
    linesAdded: $linesAdded,
    linesRemoved: $linesRemoved,
    typecheck: { before: $baselineTypecheck, after: $afterTypecheck, errorDelta: $tcErrors },
    tests: {
      before: { total: $baselineTotal, passed: $baselinePassed },
      after: { total: $afterTotal, passed: $afterPassed, failed: $afterFailed }
    },
    error: $error,
    diffStat: $diffStat
  }' > "$RESULT_FILE"

echo ""
echo "=== Benchmark Complete ==="
echo "Result: ${RESULT_FILE}"
echo "Phase: ${PHASE}"
echo "Duration: ${DURATION_MS}ms"
echo "Files changed: ${FILES_CHANGED}"
echo "Lines: +${LINES_ADDED} -${LINES_REMOVED}"
echo "Typecheck: ${BASELINE_TYPECHECK} -> ${AFTER_TYPECHECK}"
echo "Tests: ${BASELINE_PASSED}/${BASELINE_TOTAL} -> ${AFTER_PASSED}/${AFTER_TOTAL}"
echo "Trace: ${TRACE_URL}"
if [ "$ERROR_MSG" != "null" ]; then
  echo "Error: ${ERROR_MSG}"
fi

# Kill server
kill $SERVER_PID 2>/dev/null || true
