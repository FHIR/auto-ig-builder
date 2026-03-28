#!/bin/bash
# Snapshot current Kubernetes state in fhir namespace (READ ONLY)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT/out"
mkdir -p "$OUT_DIR"

echo "=== Current pods ==="
kubectl -n fhir get pods -o wide 2>&1 | tee "$OUT_DIR/k8s-pods.txt"

echo ""
echo "=== Current jobs ==="
kubectl -n fhir get jobs -o json 2>&1 > "$OUT_DIR/k8s-jobs.json"
kubectl -n fhir get jobs --sort-by=.metadata.creationTimestamp \
  -o custom-columns='NAME:.metadata.name,CREATED:.metadata.creationTimestamp,SUCCEEDED:.status.succeeded,FAILED:.status.failed,ACTIVE:.status.active,GROUP:.metadata.labels.job-group-id' \
  2>&1 | tee "$OUT_DIR/k8s-jobs.txt"

echo ""
echo "=== Recent events (last 100) ==="
kubectl -n fhir get events --sort-by='.lastTimestamp' 2>&1 | tail -100 | tee "$OUT_DIR/k8s-events.txt"

echo ""
echo "=== Completed/failed jobs in last 24h ==="
kubectl -n fhir get jobs -o json 2>&1 | jq -r '
  .items[] |
  "\(.metadata.name) created=\(.metadata.creationTimestamp) succeeded=\(.status.succeeded // 0) failed=\(.status.failed // 0)"
' 2>/dev/null | tee "$OUT_DIR/k8s-job-summary.txt"
