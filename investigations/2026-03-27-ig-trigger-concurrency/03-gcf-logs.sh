#!/bin/bash
# Fetch Cloud Function logs for the ig-commit-trigger
# Shows every webhook invocation and job creation
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT/out"
mkdir -p "$OUT_DIR"

echo "=== Cloud Function logs (last 500 entries) ==="
gcloud functions logs read ig-commit-trigger \
  --region=us-central1 \
  --limit=500 \
  --format=json \
  > "$OUT_DIR/gcf-logs.json" 2>&1

# Human-readable summary
echo "=== Trigger invocations timeline ==="
jq -r '.[] | select(.log != null) | "\(.time_utc) \(.severity) \(.log)"' "$OUT_DIR/gcf-logs.json" \
  2>/dev/null | head -200 | tee "$OUT_DIR/gcf-logs-readable.txt"

echo ""
echo "=== Job group IDs triggered ==="
jq -r '.[] | select(.log != null and (.log | test("Job group id"))) | "\(.time_utc) \(.log)"' "$OUT_DIR/gcf-logs.json" \
  2>/dev/null | tee "$OUT_DIR/gcf-job-groups.txt"

echo ""
echo "=== Crashes / errors ==="
jq -r '.[] | select(.severity == "E" or (.log != null and (.log | test("Error|crash|fail"; "i")))) | "\(.time_utc) \(.log)"' "$OUT_DIR/gcf-logs.json" \
  2>/dev/null | tee "$OUT_DIR/gcf-errors.txt"
