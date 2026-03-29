#!/usr/bin/env bash
set -euo pipefail

# Sanitize a variable to a clean integer (strips whitespace, newlines, defaults to 0)
sanitize_int() {
  local val="${1:-0}"
  # Extract the last number found anywhere in the string (handles multiline, trailing newlines)
  val=$(echo "$val" | grep -oE '[0-9]+' | tail -1)
  echo "${val:-0}"
}

sum_process_tree_rss_kb() {
  local root_pid="${1:-}"
  [ -n "$root_pid" ] || { echo 0; return; }

  local total=0
  local queue=("$root_pid")
  local seen=" "

  while [ ${#queue[@]} -gt 0 ]; do
    local pid="${queue[0]}"
    queue=("${queue[@]:1}")
    case "$seen" in
      *" ${pid} "*) continue ;;
    esac
    seen+="${pid} "

    local rss
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    if [[ "$rss" =~ ^[0-9]+$ ]]; then
      total=$((total + rss))
    fi

    while IFS= read -r child_pid; do
      [ -n "$child_pid" ] && queue+=("$child_pid")
    done < <(pgrep -P "$pid" 2>/dev/null || true)
  done

  echo "$total"
}

# Usage: ./scripts/bench.sh <instruction-name>
# Example: ./scripts/bench.sh 01-strict-typescript

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="${SHIPYARD_TARGET:-/Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored}"
PORT="${SHIPYARD_PORT:-4200}"
BASE_URL="http://localhost:${PORT}/api"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <instruction-name>"
  echo "  e.g. $0 01-strict-typescript"
  exit 1
fi

BENCH_NAME="$1"
INSTRUCTION_FILE="${AGENT_DIR}/instructions/${BENCH_NAME}.md"
BENCHMARK_PROJECT_ID="benchmark:bench"
BENCHMARK_PROJECT_LABEL="Benchmark Suite"

if [ ! -f "$INSTRUCTION_FILE" ]; then
  echo "Error: instruction file not found: $INSTRUCTION_FILE"
  exit 1
fi

INSTRUCTION=$(cat "$INSTRUCTION_FILE")
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%S")
BENCH_ID="bench-${BENCH_NAME}-${TIMESTAMP}"
RESULTS_DIR="${SHIPYARD_BENCHMARK_RESULTS_DIR:-${SHIPYARD_RESULTS_DIR:-${AGENT_DIR}/results/benchmarks}}"
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
# Extract only the final summary line (e.g. "Tests  58 passed (721)")
BASELINE_TOTAL=$(echo "$BASELINE_TEST_OUTPUT" | grep -oE 'Tests[[:space:]]+[0-9]+' | grep -oE '[0-9]+' | tail -1 || echo "0")
BASELINE_PASSED=$(echo "$BASELINE_TEST_OUTPUT" | grep -oE '[0-9]+ passed' | tail -1 | grep -oE '[0-9]+' || echo "0")
# Ensure single value
BASELINE_TOTAL="${BASELINE_TOTAL:-0}"
BASELINE_PASSED="${BASELINE_PASSED:-0}"

echo "  Baseline: typecheck=${BASELINE_TYPECHECK}, tests=${BASELINE_TOTAL} total / ${BASELINE_PASSED} passed"

# Step 3: Start Shipyard server in background
echo "[3/8] Starting Shipyard server..."
cd "$AGENT_DIR"

# Load .env, then force workdir to the bench target (not ship-agent cwd)
set -a
source .env 2>/dev/null || true
SHIPYARD_WORK_DIR="$TARGET"
SHIPYARD_RESULTS_DIR="$RESULTS_DIR"
SHIPYARD_BENCHMARK_RESULTS_DIR="$RESULTS_DIR"
export SHIPYARD_WORK_DIR
export SHIPYARD_RESULTS_DIR
export SHIPYARD_BENCHMARK_RESULTS_DIR
set +a

npx tsx src/index.ts &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT
PEAK_RSS_KB=0

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
    --arg projectId "$BENCHMARK_PROJECT_ID" \
    --arg projectLabel "$BENCHMARK_PROJECT_LABEL" \
    '{
      instruction: $instruction,
      projectContext: { projectId: $projectId, projectLabel: $projectLabel },
      contexts: [{
        label: "CLAUDE.md",
        content: $claudemd,
        source: "system"
      }]
    }')
else
  REQUEST_BODY=$(jq -n \
    --arg instruction "$INSTRUCTION" \
    --arg projectId "$BENCHMARK_PROJECT_ID" \
    --arg projectLabel "$BENCHMARK_PROJECT_LABEL" \
    '{ instruction: $instruction, projectContext: { projectId: $projectId, projectLabel: $projectLabel } }')
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
  CURRENT_RSS_KB=$(sum_process_tree_rss_kb "$SERVER_PID")
  if [ "$CURRENT_RSS_KB" -gt "$PEAK_RSS_KB" ]; then
    PEAK_RSS_KB="$CURRENT_RSS_KB"
  fi
  echo "  Phase: ${PHASE}"
done

CURRENT_RSS_KB=$(sum_process_tree_rss_kb "$SERVER_PID")
if [ "$CURRENT_RSS_KB" -gt "$PEAK_RSS_KB" ]; then
  PEAK_RSS_KB="$CURRENT_RSS_KB"
fi

END_TIME=$(date +%s)
DURATION_MS=$(( (END_TIME - START_TIME) * 1000 ))

# Extract run data (handle null tokenUsage gracefully)
TOKEN_INPUT=$(echo "$RUN_RESPONSE" | jq 'if .tokenUsage then .tokenUsage.input // 0 else 0 end')
TOKEN_OUTPUT=$(echo "$RUN_RESPONSE" | jq 'if .tokenUsage then .tokenUsage.output // 0 else 0 end')
TRACE_URL=$(echo "$RUN_RESPONSE" | jq -r '.traceUrl // "none"')
ERROR_MSG=$(echo "$RUN_RESPONSE" | jq -r '.error // "null"')

# Step 7: Run post-bench verification
echo "[7/8] Running post-bench verification in ship-refactored..."
cd "$TARGET"

AFTER_TYPECHECK="pass"
TC_OUTPUT=""
if ! TC_OUTPUT=$(pnpm type-check 2>&1); then
  AFTER_TYPECHECK="fail"
fi
# Count error TS occurrences; grep -c may return multi-line from recursive workspace
TC_ERRORS=$(echo "$TC_OUTPUT" | grep "error TS" | wc -l | tr -d ' ')
TC_ERRORS="${TC_ERRORS:-0}"

AFTER_TEST_OUTPUT=$(pnpm test 2>&1 || true)
AFTER_TOTAL=$(echo "$AFTER_TEST_OUTPUT" | grep -oE 'Tests[[:space:]]+[0-9]+' | grep -oE '[0-9]+' | tail -1 || echo "0")
AFTER_PASSED=$(echo "$AFTER_TEST_OUTPUT" | grep -oE '[0-9]+ passed' | tail -1 | grep -oE '[0-9]+' || echo "0")
AFTER_FAILED=$(echo "$AFTER_TEST_OUTPUT" | grep -oE '[0-9]+ failed' | tail -1 | grep -oE '[0-9]+' || echo "0")
AFTER_TOTAL="${AFTER_TOTAL:-0}"
AFTER_PASSED="${AFTER_PASSED:-0}"
AFTER_FAILED="${AFTER_FAILED:-0}"

# Step 8: Collect diff stats
echo "[8/8] Collecting diff stats..."
DIFF_STAT=$(git diff --stat)
DIFF_SHORTSTAT=$(git diff --shortstat)
FILES_CHANGED=$(echo "$DIFF_SHORTSTAT" | grep -oE '[0-9]+ file' | grep -oE '[0-9]+' || echo "0")
LINES_ADDED=$(echo "$DIFF_SHORTSTAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
LINES_REMOVED=$(echo "$DIFF_SHORTSTAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")

# ── Build size ──────────────────────────────────────────────
echo "📦 Measuring build size..."
BUILD_SIZE="N/A"
NODE_MODULES_SIZE="N/A"
if command -v du &>/dev/null; then
  NODE_MODULES_SIZE=$(du -sh "${TARGET}/node_modules" 2>/dev/null | cut -f1 || echo "N/A")
fi
# Try building and measure output
if [ -f "${TARGET}/package.json" ]; then
  cd "$TARGET"
  pnpm build --filter='./shared' --filter='./api' 2>/dev/null
  BUILD_SIZE=$(du -sh "${TARGET}/*/dist" 2>/dev/null | tail -1 | cut -f1 || echo "N/A")
  cd - >/dev/null
fi

# ── Security audit ──────────────────────────────────────────
echo "🔒 Running security audit..."
AUDIT_VULNS=0
AUDIT_OUTPUT=""
if command -v pnpm &>/dev/null; then
  cd "$TARGET"
  AUDIT_OUTPUT=$(pnpm audit --json 2>/dev/null || echo '{}')
  AUDIT_VULNS=$(echo "$AUDIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('total',0))" 2>/dev/null || echo "0")
  cd - >/dev/null
fi

# ── Edit tier distribution ──────────────────────────────────
echo "📊 Analyzing edit tiers..."
TIER1=0; TIER2=0; TIER3=0; TIER4=0
EDIT_TOOL_CALLS=0
if [ -f "${RESULTS_DIR}/${RUN_ID}.json" ]; then
  TIER1=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/${RUN_ID}.json')); print(sum(1 for e in d.get('fileEdits',[]) if e.get('tier')==1))" 2>/dev/null || echo "0")
  TIER2=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/${RUN_ID}.json')); print(sum(1 for e in d.get('fileEdits',[]) if e.get('tier')==2))" 2>/dev/null || echo "0")
  TIER3=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/${RUN_ID}.json')); print(sum(1 for e in d.get('fileEdits',[]) if e.get('tier')==3))" 2>/dev/null || echo "0")
  TIER4=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/${RUN_ID}.json')); print(sum(1 for e in d.get('fileEdits',[]) if e.get('tier')==4))" 2>/dev/null || echo "0")
  EDIT_TOOL_CALLS=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/${RUN_ID}.json')); print(sum(1 for e in d.get('toolCallHistory',[]) if e.get('tool_name') in ('edit_file','write_file')))" 2>/dev/null || echo "0")
fi

# Sanitize ALL numeric variables before jq (prevent empty/multiline breakage)
TOKEN_INPUT=$(sanitize_int "$TOKEN_INPUT")
TOKEN_OUTPUT=$(sanitize_int "$TOKEN_OUTPUT")
DURATION_MS=$(sanitize_int "$DURATION_MS")
TC_ERRORS=$(sanitize_int "$TC_ERRORS")
FILES_CHANGED=$(sanitize_int "$FILES_CHANGED")
LINES_ADDED=$(sanitize_int "$LINES_ADDED")
LINES_REMOVED=$(sanitize_int "$LINES_REMOVED")
BASELINE_TOTAL=$(sanitize_int "$BASELINE_TOTAL")
BASELINE_PASSED=$(sanitize_int "$BASELINE_PASSED")
AFTER_TOTAL=$(sanitize_int "$AFTER_TOTAL")
AFTER_PASSED=$(sanitize_int "$AFTER_PASSED")
AFTER_FAILED=$(sanitize_int "$AFTER_FAILED")
AUDIT_VULNS=$(sanitize_int "$AUDIT_VULNS")
TIER1=$(sanitize_int "$TIER1")
TIER2=$(sanitize_int "$TIER2")
TIER3=$(sanitize_int "$TIER3")
TIER4=$(sanitize_int "$TIER4")
EDIT_TOOL_CALLS=$(sanitize_int "$EDIT_TOOL_CALLS")
PEAK_RSS_KB=$(sanitize_int "$PEAK_RSS_KB")

# Sanitize string vars (ensure non-empty)
PHASE="${PHASE:-unknown}"
TRACE_URL="${TRACE_URL:-none}"
ERROR_MSG="${ERROR_MSG:-null}"
DIFF_STAT="${DIFF_STAT:-}"
BUILD_SIZE="${BUILD_SIZE:-N/A}"
NODE_MODULES_SIZE="${NODE_MODULES_SIZE:-N/A}"

# Estimate cost (rough average of Opus + Sonnet mix)
# Opus: $15/M input, $75/M output; Sonnet: $3/M input, $15/M output
# Blended rate: ~$9/M input, ~$45/M output
COST=$(awk "BEGIN { printf \"%.2f\", ($TOKEN_INPUT * 0.000009 + $TOKEN_OUTPUT * 0.000045) }" 2>/dev/null || echo "0.00")

# Write result JSON (set +e so jq failure doesn't abort; capture stderr)
set +e
JQ_ERR=$(jq -n \
  --arg benchId "$BENCH_ID" \
  --arg instruction "$BENCH_NAME" \
  --arg startedAt "$(date -u -r "$START_TIME" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg completedAt "$(date -u -r "$END_TIME" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson durationMs "$DURATION_MS" \
  --argjson peakRssKb "$PEAK_RSS_KB" \
  --arg phase "$PHASE" \
  --argjson tokenInput "$TOKEN_INPUT" \
  --argjson tokenOutput "$TOKEN_OUTPUT" \
  --arg estimatedCost "\$${COST}" \
  --arg traceUrl "$TRACE_URL" \
  --argjson filesChanged "$FILES_CHANGED" \
  --argjson editToolCalls "$EDIT_TOOL_CALLS" \
  --argjson linesAdded "$LINES_ADDED" \
  --argjson linesRemoved "$LINES_REMOVED" \
  --arg baselineTypecheck "$BASELINE_TYPECHECK" \
  --arg afterTypecheck "$AFTER_TYPECHECK" \
  --argjson tcErrors "$TC_ERRORS" \
  --argjson baselineTotal "$BASELINE_TOTAL" \
  --argjson baselinePassed "$BASELINE_PASSED" \
  --argjson afterTotal "$AFTER_TOTAL" \
  --argjson afterPassed "$AFTER_PASSED" \
  --argjson afterFailed "$AFTER_FAILED" \
  --arg error "$ERROR_MSG" \
  --arg diffStat "$DIFF_STAT" \
  --arg buildSize "$BUILD_SIZE" \
  --arg nodeModulesSize "$NODE_MODULES_SIZE" \
  --argjson auditVulns "$AUDIT_VULNS" \
  --argjson tier1 "$TIER1" \
  --argjson tier2 "$TIER2" \
  --argjson tier3 "$TIER3" \
  --argjson tier4 "$TIER4" \
  '{
    benchId: $benchId,
    instruction: $instruction,
    startedAt: $startedAt,
    completedAt: $completedAt,
    durationMs: $durationMs,
    peakRssKb: $peakRssKb,
    phase: $phase,
    tokenUsage: { input: $tokenInput, output: $tokenOutput },
    estimatedCost: $estimatedCost,
    traceUrl: $traceUrl,
    filesChanged: $filesChanged,
    editToolCalls: $editToolCalls,
    linesAdded: $linesAdded,
    linesRemoved: $linesRemoved,
    typecheck: { before: $baselineTypecheck, after: $afterTypecheck, errorDelta: $tcErrors },
    tests: {
      before: { total: $baselineTotal, passed: $baselinePassed },
      after: { total: $afterTotal, passed: $afterPassed, failed: $afterFailed }
    },
    buildSize: $buildSize,
    nodeModulesSize: $nodeModulesSize,
    securityAudit: { vulnerabilities: $auditVulns },
    editTiers: { tier1: $tier1, tier2: $tier2, tier3: $tier3, tier4: $tier4 },
    error: $error,
    diffStat: $diffStat
  }' > "$RESULT_FILE" 2>&1)
JQ_EXIT=$?
set -e

if [ "$JQ_EXIT" -ne 0 ]; then
  echo "  WARNING: jq failed (exit $JQ_EXIT): $JQ_ERR"
  # Write fallback JSON so the file is never 0 bytes
  cat > "$RESULT_FILE" <<FALLBACK_EOF
{
  "benchId": "${BENCH_ID}",
  "instruction": "${BENCH_NAME}",
  "phase": "${PHASE}",
  "durationMs": ${DURATION_MS},
  "error": "jq serialization failed: ${JQ_ERR}",
  "tokenUsage": { "input": ${TOKEN_INPUT}, "output": ${TOKEN_OUTPUT} }
}
FALLBACK_EOF
fi

echo ""
echo "=== Benchmark Complete ==="
echo "Result: ${RESULT_FILE}"
echo "Phase: ${PHASE}"
echo "Duration: ${DURATION_MS}ms"
echo "Peak RSS: ${PEAK_RSS_KB} KB"
echo "Files changed: ${FILES_CHANGED}"
echo "Lines: +${LINES_ADDED} -${LINES_REMOVED}"
echo "Typecheck: ${BASELINE_TYPECHECK} -> ${AFTER_TYPECHECK}"
echo "Tests: ${BASELINE_PASSED}/${BASELINE_TOTAL} -> ${AFTER_PASSED}/${AFTER_TOTAL}"
echo "Trace: ${TRACE_URL}"
if [ "$ERROR_MSG" != "null" ]; then
  echo "Error: ${ERROR_MSG}"
fi

echo "📚 Regenerating docs..."
cd "$AGENT_DIR"
pnpm exec tsx scripts/render-benchmarks.ts
pnpm exec tsx scripts/render-issues.ts

# Kill server
kill $SERVER_PID 2>/dev/null || true
