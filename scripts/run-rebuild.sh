#!/usr/bin/env bash
set -euo pipefail

# Sequential Ship rebuild: submit instructions 03-09 to the Shipyard agent
# One instruction at a time (single WORK_DIR; avoids concurrent file edits). Stops if any step is not phase=done.
#
# Env:
#   REBUILD_SKIP_DONE=1 (default) — skip steps whose /tmp/ship-rebuild-<name>.phase is already "done"
#   REBUILD_SKIP_DONE=0 — always re-run every instruction
#   REBUILD_ONLY=03-database-schema-and-migrations,05-document-crud-api — run only listed steps
#   REBUILD_FROM=05-document-crud-api / REBUILD_TO=07-react-frontend-shell — run inclusive range
#   REBUILD_THREAD_MODE=isolated — isolated|followup; isolated keeps each step in its own run/trace
#   REBUILD_STEP_RETRIES=12 — max submit attempts per instruction when API returns rate_limit / 429
#   REBUILD_STATE_PREFIX=/tmp/ship-rebuild-demo — isolate log/marker files per campaign
# Server must be restarted after code changes (pnpm dev / start).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="${SHIPYARD_TARGET:-/Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored}"
PORT="${SHIPYARD_PORT:-4200}"
BASE_URL="http://localhost:${PORT}/api"
RESULTS_DIR="${SHIPYARD_BENCHMARK_RESULTS_DIR:-${SHIPYARD_RESULTS_DIR:-${AGENT_DIR}/results/benchmarks}}"
BENCHMARK_PROJECT_ID="benchmark:rebuild"
BENCHMARK_PROJECT_LABEL="Benchmark Rebuild"
STATE_PREFIX="${REBUILD_STATE_PREFIX:-/tmp/ship-rebuild}"
REBUILD_THREAD_MODE="${REBUILD_THREAD_MODE:-isolated}"
LOG_FILE="${STATE_PREFIX}.log"
CAMPAIGN_FILE="${STATE_PREFIX}.campaign-id"
ROOT_RUN_FILE="${STATE_PREFIX}.root-run-id"
ACTIVE_RUN_FILE="${STATE_PREFIX}.active-run-id"
MANIFEST_FINGERPRINT_FILE="${STATE_PREFIX}.target-manifests.sha"
FINAL_PHASE_FILE="${STATE_PREFIX}-final-integration.phase"
FINAL_TC_LOG="${STATE_PREFIX}-final-integration.typecheck.log"
FINAL_BUILD_LOG="${STATE_PREFIX}-final-integration.build.log"
FINAL_TEST_LOG="${STATE_PREFIX}-final-integration.test.log"

# Read CLAUDE.md context
CLAUDE_MD=""
if [ -f "${TARGET}/.claude/CLAUDE.md" ]; then
  CLAUDE_MD=$(cat "${TARGET}/.claude/CLAUDE.md" | jq -Rs .)
elif [ -f "${TARGET}/CLAUDE.md" ]; then
  CLAUDE_MD=$(cat "${TARGET}/CLAUDE.md" | jq -Rs .)
fi

# Planless mode: optional supplied execution plan + plan doc (PRD/wireframes)
#   REBUILD_PLAN_FILE=/path/to/plan.json — JSON array of steps [{description, files?}]
#   REBUILD_PLAN_DOC_FILE=/path/to/prd.md — markdown doc attached as Plan Document context
EXECUTION_PLAN=""
if [ -n "${REBUILD_PLAN_FILE:-}" ] && [ -f "$REBUILD_PLAN_FILE" ]; then
  EXECUTION_PLAN=$(cat "$REBUILD_PLAN_FILE")
  echo "$(date '+%H:%M:%S') [PLANLESS] Using supplied plan from ${REBUILD_PLAN_FILE}" | tee -a "$LOG_FILE"
fi
PLAN_DOC=""
if [ -n "${REBUILD_PLAN_DOC_FILE:-}" ] && [ -f "$REBUILD_PLAN_DOC_FILE" ]; then
  PLAN_DOC=$(cat "$REBUILD_PLAN_DOC_FILE" | jq -Rs .)
  echo "$(date '+%H:%M:%S') [PLANLESS] Attaching plan doc from ${REBUILD_PLAN_DOC_FILE}" | tee -a "$LOG_FILE"
fi

RUN_UI_MODE="agent"
if [ -n "$EXECUTION_PLAN" ] || [ -n "$PLAN_DOC" ]; then
  RUN_UI_MODE="plan"
fi

extract_last_number() {
  local pattern="$1"
  local file="$2"
  python3 - "$pattern" "$file" <<'PY'
import re
import sys

pattern = re.compile(sys.argv[1], re.MULTILINE)
text = open(sys.argv[2], 'r', encoding='utf-8', errors='ignore').read()
matches = pattern.findall(text)
if not matches:
  print(0)
  raise SystemExit(0)
last = matches[-1]
if isinstance(last, tuple):
  for item in reversed(last):
    if item:
      print(item)
      break
  else:
    print(0)
else:
  print(last if str(last).isdigit() else len(matches))
PY
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

resolve_listener_pid() {
  lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sed -n '1p'
}

log_snippet() {
  local file="$1"
  local max_lines="${2:-80}"
  python3 - "$file" "$max_lines" <<'PY'
import sys

path = sys.argv[1]
max_lines = int(sys.argv[2])
with open(path, 'r', encoding='utf-8', errors='ignore') as fh:
  lines = fh.readlines()
if len(lines) <= max_lines:
  print(''.join(lines).strip())
  raise SystemExit(0)
head = max_lines // 2
tail = max_lines - head
top = ''.join(lines[:head]).strip()
bottom = ''.join(lines[-tail:]).strip()
print(f"{top}\n\n[... snip ...]\n\n{bottom}".strip())
PY
}

compute_manifest_fingerprint() {
  python3 - "$TARGET" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
paths = []
for pattern in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'):
  paths.extend(root.rglob(pattern))
digest = hashlib.sha256()
for path in sorted({p for p in paths if p.is_file()}):
  digest.update(str(path.relative_to(root)).encode())
  digest.update(b'\0')
  digest.update(path.read_bytes())
  digest.update(b'\0')
print(digest.hexdigest())
PY
}

ensure_target_bootstrap() {
  local current_fingerprint
  current_fingerprint=$(compute_manifest_fingerprint)
  local previous_fingerprint
  previous_fingerprint=$(cat "$MANIFEST_FINGERPRINT_FILE" 2>/dev/null || true)
  local needs_install="false"

  if [ ! -d "${TARGET}/node_modules" ] || [ "$current_fingerprint" != "$previous_fingerprint" ]; then
    needs_install="true"
    echo "$(date '+%H:%M:%S') [BOOTSTRAP] installing target dependencies in ${TARGET}" | tee -a "$LOG_FILE"
    (cd "${TARGET}" && pnpm install) | tee -a "$LOG_FILE"
    printf '%s' "$current_fingerprint" > "$MANIFEST_FINGERPRINT_FILE"
  elif [ ! -f "$MANIFEST_FINGERPRINT_FILE" ]; then
    printf '%s' "$current_fingerprint" > "$MANIFEST_FINGERPRINT_FILE"
  fi

  if [ -f "${TARGET}/shared/package.json" ] && { [ ! -f "${TARGET}/shared/dist/index.js" ] || [ "$needs_install" = "true" ]; }; then
    echo "$(date '+%H:%M:%S') [BOOTSTRAP] building @ship/shared in ${TARGET}" | tee -a "$LOG_FILE"
    (cd "${TARGET}" && pnpm --filter @ship/shared build) | tee -a "$LOG_FILE"
  fi
}

submit_and_poll() {
  local name="$1"
  local instruction_override="${2:-}"
  local file="${AGENT_DIR}/instructions/${name}.md"
  local instruction=""
  if [ -n "$instruction_override" ]; then
    instruction="$instruction_override"
  else
    instruction=$(cat "$file")
  fi
  local phase_file="${STATE_PREFIX}-${name}.phase"
  local run_id_file="${STATE_PREFIX}-${name}.run-id"
  local previous_phase=""
  local previous_run_id=""
  local campaign_id
  campaign_id=$(cat "$CAMPAIGN_FILE" 2>/dev/null || true)
  local root_run_id
  root_run_id=$(cat "$ROOT_RUN_FILE" 2>/dev/null || true)
  local active_run_id
  active_run_id=$(cat "$ACTIVE_RUN_FILE" 2>/dev/null || true)
  previous_phase=$(cat "$phase_file" 2>/dev/null || true)
  previous_run_id=$(cat "$run_id_file" 2>/dev/null || true)

  echo "$(date '+%H:%M:%S') [SUBMIT] ${name} campaign=${campaign_id:-none} root=${root_run_id:-none} active=${active_run_id:-none}" | tee -a "$LOG_FILE"

  local response=""
  local run_id
  local submit_mode="new"

  if [ "${REBUILD_SKIP_DONE:-1}" = "1" ] && [ -n "$previous_run_id" ] && [ "$previous_phase" != "done" ]; then
    submit_mode="resume"
    response=$(curl -sf -X POST "${BASE_URL}/runs/${previous_run_id}/resume" \
      -H "Content-Type: application/json" \
      -d '{}' || true)
    run_id=$(echo "$response" | jq -r '.runId // empty' 2>/dev/null || true)
  fi

  if [ "$REBUILD_THREAD_MODE" = "followup" ] && [ -z "${run_id:-}" ] && [ -n "$active_run_id" ]; then
    submit_mode="followup"
    response=$(jq -n --arg instruction "$instruction" '{ instruction: $instruction, uiMode: "agent" }' | \
      curl -sf -X POST "${BASE_URL}/runs/${active_run_id}/followup" \
        -H "Content-Type: application/json" \
        --data-binary @- || true)
    run_id=$(echo "$response" | jq -r '.runId // empty' 2>/dev/null || true)
  fi

  if [ -z "${run_id:-}" ]; then
    submit_mode="new"
    local body
    # Build optional jq args for planless mode
    local plan_args=()
    local plan_merge=""
    if [ -n "$EXECUTION_PLAN" ]; then
      plan_args+=(--argjson executionPlan "$EXECUTION_PLAN")
      plan_merge='+ { executionPlan: $executionPlan }'
    fi
    if [ -n "$PLAN_DOC" ]; then
      plan_args+=(--argjson planDoc "$PLAN_DOC")
      plan_merge="${plan_merge}"'+ { planDoc: $planDoc }'
    fi

    if [ -n "$CLAUDE_MD" ]; then
      body=$(jq -n \
        --arg instruction "$instruction" \
        --argjson claudemd "$CLAUDE_MD" \
        --arg campaignId "$campaign_id" \
        --arg rootRunId "$root_run_id" \
        --arg parentRunId "$active_run_id" \
        --arg uiMode "$RUN_UI_MODE" \
        --arg projectId "$BENCHMARK_PROJECT_ID" \
        --arg projectLabel "$BENCHMARK_PROJECT_LABEL" \
        "${plan_args[@]}" \
        '{
          instruction: $instruction,
          uiMode: $uiMode,
          projectContext: { projectId: $projectId, projectLabel: $projectLabel },
          contexts: [{
            label: "CLAUDE.md",
            content: $claudemd,
            source: "system"
          }]
        }
        + (if $campaignId != "" then { campaignId: $campaignId } else {} end)
        + (if $rootRunId != "" then { rootRunId: $rootRunId } else {} end)
        + (if $parentRunId != "" then { parentRunId: $parentRunId } else {} end)
        '"${plan_merge}")
    else
      body=$(jq -n \
        --arg instruction "$instruction" \
        --arg campaignId "$campaign_id" \
        --arg rootRunId "$root_run_id" \
        --arg parentRunId "$active_run_id" \
        --arg uiMode "$RUN_UI_MODE" \
        --arg projectId "$BENCHMARK_PROJECT_ID" \
        --arg projectLabel "$BENCHMARK_PROJECT_LABEL" \
        "${plan_args[@]}" \
        '{ instruction: $instruction, uiMode: $uiMode, projectContext: { projectId: $projectId, projectLabel: $projectLabel } }
        + (if $campaignId != "" then { campaignId: $campaignId } else {} end)
        + (if $rootRunId != "" then { rootRunId: $rootRunId } else {} end)
        + (if $parentRunId != "" then { parentRunId: $parentRunId } else {} end)
        '"${plan_merge}")
    fi
    response=$(curl -sf -X POST "${BASE_URL}/run" \
      -H "Content-Type: application/json" \
      -d "$body")
    run_id=$(echo "$response" | jq -r '.runId')
  fi

  if [ -z "$run_id" ]; then
    echo "$(date '+%H:%M:%S') [FAIL] ${name} submit failed mode=${submit_mode}" | tee -a "$LOG_FILE"
    echo "error: failed to obtain runId" > "${STATE_PREFIX}-${name}.last-error"
    echo "error" > "$phase_file"
    return 1
  fi

  if [ -z "$root_run_id" ]; then
    root_run_id="$run_id"
    printf '%s' "$root_run_id" > "$ROOT_RUN_FILE"
  fi
  printf '%s' "$run_id" > "$ACTIVE_RUN_FILE"
  printf '%s' "$run_id" > "$run_id_file"
  echo "$(date '+%H:%M:%S') [RUN_ID] ${name} -> ${run_id} mode=${submit_mode} thread_mode=${REBUILD_THREAD_MODE}" | tee -a "$LOG_FILE"

  # Poll
  local phase="planning"
  local poll_count=0
  local listener_pid
  listener_pid=$(resolve_listener_pid)
  local peak_rss_kb=0
  while [ "$phase" != "done" ] && [ "$phase" != "error" ]; do
    sleep 10
    poll_count=$((poll_count + 1))
    local run_data
    run_data=$(curl -sf "${BASE_URL}/runs/${run_id}" || echo '{"phase":"polling"}')
    phase=$(echo "$run_data" | jq -r '.phase // "polling"')
    if [ -n "$listener_pid" ]; then
      local current_rss_kb
      current_rss_kb=$(sum_process_tree_rss_kb "$listener_pid")
      if [ "$current_rss_kb" -gt "$peak_rss_kb" ]; then
        peak_rss_kb="$current_rss_kb"
      fi
    fi

    if [ $((poll_count % 6)) -eq 0 ]; then
      echo "$(date '+%H:%M:%S') [POLL] ${name}: phase=${phase} (${poll_count}0s elapsed)" | tee -a "$LOG_FILE"
    fi
  done

  if [ -n "$listener_pid" ]; then
    local current_rss_kb
    current_rss_kb=$(sum_process_tree_rss_kb "$listener_pid")
    if [ "$current_rss_kb" -gt "$peak_rss_kb" ]; then
      peak_rss_kb="$current_rss_kb"
    fi
  fi

  # Extract results
  local duration tokens trace_url
  duration=$(echo "$run_data" | jq '.durationMs // 0')
  tokens=$(echo "$run_data" | jq '(.tokenUsage.input // 0) + (.tokenUsage.output // 0)')
  trace_url=$(echo "$run_data" | jq -r '.traceUrl // "none"')
  local steps edits edit_tool_calls tools
  steps=$(echo "$run_data" | jq '.steps | length')
  edits=$(echo "$run_data" | jq '.fileEdits | length')
  edit_tool_calls=$(echo "$run_data" | jq '[.toolCallHistory[]? | select(.tool_name == "edit_file" or .tool_name == "write_file")] | length')
  tools=$(echo "$run_data" | jq '.toolCallHistory | length')

  echo "$(date '+%H:%M:%S') [DONE] ${name}: phase=${phase} duration=${duration}ms tokens=${tokens} steps=${steps} edits=${edits} edit_tools=${edit_tool_calls} tools=${tools} rss_kb=${peak_rss_kb}" | tee -a "$LOG_FILE"
  echo "  trace: ${trace_url}" | tee -a "$LOG_FILE"

  echo "$run_data" | jq -r '.error // empty' > "${STATE_PREFIX}-${name}.last-error"

  # Return phase for caller
  echo "$phase" > "$phase_file"
}

# Re-submit the same instruction until done or non-rate-limit error (or max attempts).
submit_until_done_or_give_up() {
  local name="$1"
  local instruction_override="${2:-}"
  local max_attempts="${REBUILD_STEP_RETRIES:-12}"
  local attempt=0
  while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    submit_and_poll "$name" "$instruction_override"
    local ph
    ph=$(cat "${STATE_PREFIX}-${name}.phase" 2>/dev/null || echo "unknown")
    if [ "$ph" = "done" ]; then
      return 0
    fi
    local err
    err=$(cat "${STATE_PREFIX}-${name}.last-error" 2>/dev/null || true)
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

capture_final_integration_snapshot() {
  local timestamp="$1"
  local tc_status="$2"
  local tc_errors="$3"
  local build_status="$4"
  local build_duration_ms="$5"
  local test_total="$6"
  local test_passed="$7"
  local test_failed="$8"
  mkdir -p "$RESULTS_DIR"
  local out_file="${RESULTS_DIR}/snapshot-rebuild-final-${timestamp}.json"
  jq -n \
    --arg type "snapshot" \
    --arg label "rebuild-final" \
    --arg source "rebuild-runner" \
    --arg timestamp "$timestamp" \
    --arg path "$TARGET" \
    --arg tcStatus "$tc_status" \
    --argjson tcErrors "$tc_errors" \
    --arg buildStatus "$build_status" \
    --argjson buildDurationMs "$build_duration_ms" \
    --argjson testTotal "$test_total" \
    --argjson testPassed "$test_passed" \
    --argjson testFailed "$test_failed" \
    '{
      type: $type,
      label: $label,
      source: $source,
      timestamp: $timestamp,
      path: $path,
      typecheck: { status: $tcStatus, errors: $tcErrors },
      build: { status: $buildStatus, durationMs: $buildDurationMs },
      tests: { total: $testTotal, passed: $testPassed, failed: $testFailed },
      security: { vulnerabilities: 0 },
      loc: 0,
      files: 0,
      buildDurationMs: $buildDurationMs
    }' > "$out_file"
  echo "$(date '+%H:%M:%S') [SNAPSHOT] rebuild-final -> ${out_file}" | tee -a "$LOG_FILE"
}

run_final_integration_gate() {
  local tc_status="pass"
  local build_status="pass"
  local test_status="pass"
  local tc_errors="0"
  local test_total="0"
  local test_passed="0"
  local test_failed="0"
  local build_duration_ms="0"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  ensure_target_bootstrap

  echo "$(date '+%H:%M:%S') [FINAL] running pnpm type-check" | tee -a "$LOG_FILE"
  if ! (cd "$TARGET" && pnpm type-check > "$FINAL_TC_LOG" 2>&1); then
    tc_status="fail"
  fi
  tc_errors=$(extract_last_number 'error TS' "$FINAL_TC_LOG")

  echo "$(date '+%H:%M:%S') [FINAL] running pnpm build" | tee -a "$LOG_FILE"
  local build_start
  build_start=$(date +%s)
  if ! (cd "$TARGET" && pnpm build > "$FINAL_BUILD_LOG" 2>&1); then
    build_status="fail"
  fi
  local build_end
  build_end=$(date +%s)
  build_duration_ms=$(( (build_end - build_start) * 1000 ))
  if [ "$build_status" != "pass" ]; then
    build_duration_ms=0
  fi

  echo "$(date '+%H:%M:%S') [FINAL] running pnpm test" | tee -a "$LOG_FILE"
  if ! (cd "$TARGET" && pnpm test > "$FINAL_TEST_LOG" 2>&1); then
    test_status="fail"
  fi
  test_total=$(extract_last_number 'Tests[[:space:]]+([0-9]+)' "$FINAL_TEST_LOG")
  test_passed=$(extract_last_number '([0-9]+)[[:space:]]+passed' "$FINAL_TEST_LOG")
  test_failed=$(extract_last_number '([0-9]+)[[:space:]]+failed' "$FINAL_TEST_LOG")

  capture_final_integration_snapshot \
    "$timestamp" \
    "$tc_status" \
    "$tc_errors" \
    "$build_status" \
    "$build_duration_ms" \
    "$test_total" \
    "$test_passed" \
    "$test_failed"

  echo "$(date '+%H:%M:%S') [FINAL] typecheck=${tc_status} build=${build_status} tests=${test_status} passed=${test_passed}/${test_total}" | tee -a "$LOG_FILE"

  if [ "$tc_status" = "pass" ] && [ "$build_status" = "pass" ] && [ "$test_status" = "pass" ]; then
    echo "done" > "$FINAL_PHASE_FILE"
    return 0
  fi

  echo "error" > "$FINAL_PHASE_FILE"
  return 1
}

build_final_integration_instruction() {
  local attempt="$1"
  local tc_snippet
  local build_snippet
  local test_snippet
  tc_snippet=$(log_snippet "$FINAL_TC_LOG" 80)
  build_snippet=$(log_snippet "$FINAL_BUILD_LOG" 80)
  test_snippet=$(log_snippet "$FINAL_TEST_LOG" 80)
  cat <<EOF
Final rebuild integration check failed in ${TARGET} after steps 03 through 09 completed.

Repair the combined target so all three commands pass together with 0 new regressions:
- pnpm type-check
- pnpm build
- pnpm test

Focus only on the remaining integration defects exposed by the combined target. Keep changes inside ${TARGET}. Prefer surgical fixes over rewrites. After edits, rerun the failing commands until they pass.

Integration retry attempt: ${attempt}

Typecheck output:
${tc_snippet}

Build output:
${build_snippet}

Test output:
${test_snippet}
EOF
}

repair_final_integration() {
  local max_attempts="${REBUILD_INTEGRATION_RETRIES:-2}"
  local attempt=0

  while true; do
    if run_final_integration_gate; then
      return 0
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "$(date '+%H:%M:%S') [FINAL] integration gate still failing after ${attempt} repair attempt(s)." | tee -a "$LOG_FILE"
      return 1
    fi

    attempt=$((attempt + 1))
    echo "$(date '+%H:%M:%S') [FINAL] submitting integration repair attempt ${attempt}/${max_attempts}" | tee -a "$LOG_FILE"
    local instruction
    instruction=$(build_final_integration_instruction "$attempt")
    if ! submit_until_done_or_give_up "final-integration-fix-${attempt}" "$instruction"; then
      echo "$(date '+%H:%M:%S') [FINAL] integration repair run failed." | tee -a "$LOG_FILE"
      return 1
    fi
  done
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

START_ALL=$(date +%s)

if [ "${REBUILD_SKIP_DONE:-1}" = "0" ] || [ ! -s "$CAMPAIGN_FILE" ]; then
  python3 - <<'PY' > "$CAMPAIGN_FILE"
import uuid
print(uuid.uuid4(), end='')
PY
  : > "$ROOT_RUN_FILE"
  : > "$ACTIVE_RUN_FILE"
fi

INSTRUCTIONS_ALL=(
  "03-database-schema-and-migrations"
  "04-auth-and-session-management"
  "05-document-crud-api"
  "06-realtime-collaboration"
  "07-react-frontend-shell"
  "08-tiptap-rich-text-editor"
  "09-file-uploads-and-comments"
)

INSTRUCTIONS=()
if [ -n "${REBUILD_ONLY:-}" ]; then
  IFS=',' read -r -a INSTRUCTIONS <<< "${REBUILD_ONLY}"
else
  started_range="true"
  if [ -n "${REBUILD_FROM:-}" ]; then
    started_range="false"
  fi
  for name in "${INSTRUCTIONS_ALL[@]}"; do
    if [ "$started_range" = "false" ] && [ "$name" = "${REBUILD_FROM}" ]; then
      started_range="true"
    fi
    if [ "$started_range" = "true" ]; then
      INSTRUCTIONS+=("$name")
    fi
    if [ -n "${REBUILD_TO:-}" ] && [ "$name" = "${REBUILD_TO}" ]; then
      break
    fi
  done
fi

if [ ${#INSTRUCTIONS[@]} -eq 0 ]; then
  echo "ERROR: No instructions selected." | tee "$LOG_FILE"
  exit 1
fi

echo "============================================" | tee "$LOG_FILE"
echo "  SHIP REBUILD: Selected instructions" | tee -a "$LOG_FILE"
echo "  Started: $(date)" | tee -a "$LOG_FILE"
echo "  Target: ${TARGET}" | tee -a "$LOG_FILE"
echo "  Steps: ${INSTRUCTIONS[*]}" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

echo "  Campaign: $(cat "$CAMPAIGN_FILE" 2>/dev/null || echo unknown)" | tee -a "$LOG_FILE"

ensure_target_bootstrap

# Verify server is up
if ! curl -sf "${BASE_URL}/health" > /dev/null; then
  echo "ERROR: Server not running at ${BASE_URL}" | tee -a "$LOG_FILE"
  exit 1
fi

for i in "${!INSTRUCTIONS[@]}"; do
  name="${INSTRUCTIONS[$i]}"
  step=$((i + 1))
  echo "" | tee -a "$LOG_FILE"
  echo "=== [${step}/${#INSTRUCTIONS[@]}] ${name} ===" | tee -a "$LOG_FILE"

  if [ "${REBUILD_SKIP_DONE:-1}" = "1" ]; then
    prev=$(cat "${STATE_PREFIX}-${name}.phase" 2>/dev/null || true)
    if [ "$prev" = "done" ]; then
      echo "$(date '+%H:%M:%S') [SKIP] ${name} already done (marker file)." | tee -a "$LOG_FILE"
      continue
    fi
  fi

  if ! submit_until_done_or_give_up "$name"; then
    last_phase=$(cat "${STATE_PREFIX}-${name}.phase" 2>/dev/null || echo "unknown")
    echo "$(date '+%H:%M:%S') [ABORT] ${name} ended with phase=${last_phase}; stopping pipeline." | tee -a "$LOG_FILE"
    exit 1
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "=== [final] integration gate ===" | tee -a "$LOG_FILE"
if ! repair_final_integration; then
  echo "$(date '+%H:%M:%S') [ABORT] final integration gate failed; rebuild not complete." | tee -a "$LOG_FILE"
  exit 1
fi

END_ALL=$(date +%s)
TOTAL_SECS=$((END_ALL - START_ALL))
TOTAL_MIN=$((TOTAL_SECS / 60))
TOTAL_REM_SECS=$((TOTAL_SECS % 60))

echo "" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"
echo "  SHIP REBUILD COMPLETE" | tee -a "$LOG_FILE"
echo "  Total time: ${TOTAL_MIN}m ${TOTAL_REM_SECS}s" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# Summary
echo "" | tee -a "$LOG_FILE"
echo "Results per instruction:" | tee -a "$LOG_FILE"
for name in "${INSTRUCTIONS[@]}"; do
  phase_file="${STATE_PREFIX}-${name}.phase"
  if [ -f "$phase_file" ]; then
    phase=$(cat "$phase_file")
    echo "  ${name}: ${phase}" | tee -a "$LOG_FILE"
  else
    echo "  ${name}: UNKNOWN" | tee -a "$LOG_FILE"
  fi
done
