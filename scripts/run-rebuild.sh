#!/usr/bin/env bash
set -euo pipefail

# Sequential Ship rebuild: submit instructions 03-09 to the Shipyard agent
# One instruction at a time (single WORK_DIR; avoids concurrent file edits). Stops if any step is not phase=done.
#
# Env:
#   REBUILD_SKIP_DONE=1 (default) — skip steps whose /tmp/ship-rebuild-<name>.phase is already "done"
#   REBUILD_SKIP_DONE=0 — always re-run every instruction
#   REBUILD_STEP_RETRIES=12 — max submit attempts per instruction when API returns rate_limit / 429
# Server must be restarted after code changes (pnpm dev / start).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="${SHIPYARD_TARGET:-/Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored}"
PORT="${SHIPYARD_PORT:-4200}"
BASE_URL="http://localhost:${PORT}/api"
LOG_FILE="/tmp/ship-rebuild.log"

# Read CLAUDE.md context
CLAUDE_MD=""
if [ -f "${TARGET}/.claude/CLAUDE.md" ]; then
  CLAUDE_MD=$(cat "${TARGET}/.claude/CLAUDE.md" | jq -Rs .)
elif [ -f "${TARGET}/CLAUDE.md" ]; then
  CLAUDE_MD=$(cat "${TARGET}/CLAUDE.md" | jq -Rs .)
fi

submit_and_poll() {
  local name="$1"
  local file="${AGENT_DIR}/instructions/${name}.md"
  local instruction
  instruction=$(cat "$file")

  echo "$(date '+%H:%M:%S') [SUBMIT] ${name}" | tee -a "$LOG_FILE"

  # Build request
  local body
  if [ -n "$CLAUDE_MD" ]; then
    body=$(jq -n \
      --arg instruction "$instruction" \
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
    body=$(jq -n --arg instruction "$instruction" '{ instruction: $instruction }')
  fi

  # Submit
  local response
  response=$(curl -sf -X POST "${BASE_URL}/run" \
    -H "Content-Type: application/json" \
    -d "$body")

  local run_id
  run_id=$(echo "$response" | jq -r '.runId')
  echo "$(date '+%H:%M:%S') [RUN_ID] ${name} -> ${run_id}" | tee -a "$LOG_FILE"

  # Poll
  local phase="planning"
  local poll_count=0
  while [ "$phase" != "done" ] && [ "$phase" != "error" ]; do
    sleep 10
    poll_count=$((poll_count + 1))
    local run_data
    run_data=$(curl -sf "${BASE_URL}/runs/${run_id}" || echo '{"phase":"polling"}')
    phase=$(echo "$run_data" | jq -r '.phase // "polling"')

    if [ $((poll_count % 6)) -eq 0 ]; then
      echo "$(date '+%H:%M:%S') [POLL] ${name}: phase=${phase} (${poll_count}0s elapsed)" | tee -a "$LOG_FILE"
    fi
  done

  # Extract results
  local duration tokens trace_url
  duration=$(echo "$run_data" | jq '.durationMs // 0')
  tokens=$(echo "$run_data" | jq '(.tokenUsage.input // 0) + (.tokenUsage.output // 0)')
  trace_url=$(echo "$run_data" | jq -r '.traceUrl // "none"')
  local steps edits tools
  steps=$(echo "$run_data" | jq '.steps | length')
  edits=$(echo "$run_data" | jq '.fileEdits | length')
  tools=$(echo "$run_data" | jq '.toolCallHistory | length')

  echo "$(date '+%H:%M:%S') [DONE] ${name}: phase=${phase} duration=${duration}ms tokens=${tokens} steps=${steps} edits=${edits} tools=${tools}" | tee -a "$LOG_FILE"
  echo "  trace: ${trace_url}" | tee -a "$LOG_FILE"

  echo "$run_data" | jq -r '.error // empty' > "/tmp/ship-rebuild-${name}.last-error"

  # Return phase for caller
  echo "$phase" > "/tmp/ship-rebuild-${name}.phase"
}

# Re-submit the same instruction until done or non-rate-limit error (or max attempts).
submit_until_done_or_give_up() {
  local name="$1"
  local max_attempts="${REBUILD_STEP_RETRIES:-12}"
  local attempt=0
  while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    submit_and_poll "$name"
    local ph
    ph=$(cat "/tmp/ship-rebuild-${name}.phase" 2>/dev/null || echo "unknown")
    if [ "$ph" = "done" ]; then
      return 0
    fi
    local err
    err=$(cat "/tmp/ship-rebuild-${name}.last-error" 2>/dev/null || true)
    if echo "$err" | grep -qiE 'rate_limit|429'; then
      local wait_sec=$(( attempt * 90 + RANDOM % 60 ))
      echo "$(date '+%H:%M:%S') [RETRY] ${name} rate-limited (attempt ${attempt}/${max_attempts}), sleep ${wait_sec}s" | tee -a "$LOG_FILE"
      sleep "$wait_sec"
      continue
    fi
    echo "$(date '+%H:%M:%S') [FAIL] ${name} phase=${ph} (not rate limit); not retrying." | tee -a "$LOG_FILE"
    return 1
  done
  echo "$(date '+%H:%M:%S') [FAIL] ${name} exhausted ${max_attempts} attempts." | tee -a "$LOG_FILE"
  return 1
}

# Parallel helper: run N instructions concurrently, wait for all
run_parallel() {
  local pids=()
  for name in "$@"; do
    submit_and_poll "$name" &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done
}

echo "============================================" | tee "$LOG_FILE"
echo "  SHIP REBUILD: Instructions 03-09" | tee -a "$LOG_FILE"
echo "  Started: $(date)" | tee -a "$LOG_FILE"
echo "  Target: ${TARGET}" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

START_ALL=$(date +%s)

# Verify server is up
if ! curl -sf "${BASE_URL}/health" > /dev/null; then
  echo "ERROR: Server not running at ${BASE_URL}" | tee -a "$LOG_FILE"
  exit 1
fi

# Sequential execution — single target directory, no parallel file edits
INSTRUCTIONS=(
  "03-database-schema-and-migrations"
  "04-auth-and-session-management"
  "05-document-crud-api"
  "06-realtime-collaboration"
  "07-react-frontend-shell"
  "08-tiptap-rich-text-editor"
  "09-file-uploads-and-comments"
)

for i in "${!INSTRUCTIONS[@]}"; do
  name="${INSTRUCTIONS[$i]}"
  step=$((i + 1))
  echo "" | tee -a "$LOG_FILE"
  echo "=== [${step}/7] ${name} ===" | tee -a "$LOG_FILE"

  if [ "${REBUILD_SKIP_DONE:-1}" = "1" ]; then
    prev=$(cat "/tmp/ship-rebuild-${name}.phase" 2>/dev/null || true)
    if [ "$prev" = "done" ]; then
      echo "$(date '+%H:%M:%S') [SKIP] ${name} already done (marker file)." | tee -a "$LOG_FILE"
      continue
    fi
  fi

  if ! submit_until_done_or_give_up "$name"; then
    last_phase=$(cat "/tmp/ship-rebuild-${name}.phase" 2>/dev/null || echo "unknown")
    echo "$(date '+%H:%M:%S') [ABORT] ${name} ended with phase=${last_phase}; stopping pipeline." | tee -a "$LOG_FILE"
    exit 1
  fi
done

END_ALL=$(date +%s)
TOTAL_SECS=$((END_ALL - START_ALL))
TOTAL_MIN=$((TOTAL_SECS / 60))

echo "" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"
echo "  SHIP REBUILD COMPLETE" | tee -a "$LOG_FILE"
echo "  Total time: ${TOTAL_MIN}m ${TOTAL_SECS}s" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# Summary
echo "" | tee -a "$LOG_FILE"
echo "Results per instruction:" | tee -a "$LOG_FILE"
for name in 03-database-schema-and-migrations 04-auth-and-session-management 05-document-crud-api 06-realtime-collaboration 07-react-frontend-shell 08-tiptap-rich-text-editor 09-file-uploads-and-comments; do
  phase_file="/tmp/ship-rebuild-${name}.phase"
  if [ -f "$phase_file" ]; then
    phase=$(cat "$phase_file")
    echo "  ${name}: ${phase}" | tee -a "$LOG_FILE"
  else
    echo "  ${name}: UNKNOWN" | tee -a "$LOG_FILE"
  fi
done
