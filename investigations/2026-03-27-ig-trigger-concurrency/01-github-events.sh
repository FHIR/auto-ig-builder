#!/bin/bash
# Fetch recent GitHub events for ansforge/interop-IG-document-core
# Shows push events, branch creates/deletes, PRs - helps identify rapid commit patterns
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT/out"
OUT="$OUT_DIR/github-events.json"
mkdir -p "$OUT_DIR"

echo "Fetching GitHub events for ansforge/interop-IG-document-core..."
gh api "repos/ansforge/interop-IG-document-core/events?per_page=100" > "$OUT"

echo "=== Push events by branch (last 100 events) ==="
jq -r '.[] | select(.type=="PushEvent") | "\(.created_at) \(.actor.login) \(.payload.ref) commits=\(.payload.size)"' "$OUT" | sort

echo ""
echo "=== Event type summary ==="
jq -r '.[].type' "$OUT" | sort | uniq -c | sort -rn

echo ""
echo "=== Push frequency on NicolasRessourcesCDA branch ==="
jq -r '.[] | select(.type=="PushEvent" and (.payload.ref | test("NicolasRessourcesCDA"))) | "\(.created_at) \(.actor.login) commits=\(.payload.size)"' "$OUT"

echo ""
echo "Results saved to $OUT"
