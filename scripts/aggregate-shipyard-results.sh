#!/usr/bin/env bash
# Sum tokenUsage across results/*.json (Meter A: Shipyard bench outputs).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="${1:-${SCRIPT_DIR}/../results}"

total_in=0
total_out=0
count=0

shopt -s nullglob
for f in "${RESULTS_DIR}"/*.json; do
  in=$(jq -r '.tokenUsage.input // 0' "$f" 2>/dev/null || echo 0)
  out=$(jq -r '.tokenUsage.output // 0' "$f" 2>/dev/null || echo 0)
  if [[ "$in" =~ ^[0-9]+$ ]] && [[ "$out" =~ ^[0-9]+$ ]]; then
    total_in=$((total_in + in))
    total_out=$((total_out + out))
    count=$((count + 1))
  fi
done

echo "Shipyard bench results: ${RESULTS_DIR}"
echo "Files with tokenUsage: ${count}"
echo "Total input tokens:  ${total_in}"
echo "Total output tokens: ${total_out}"
echo ""
echo "Paste the totals into docs/AI-COST.md section 1 (Meter A)."
