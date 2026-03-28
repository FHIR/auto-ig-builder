#!/bin/bash
# Deep dive into ansforge activity - check all ansforge repos that may have triggered builds
# Also look at the specific commit pattern on NicolasRessourcesCDA
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT/out"
mkdir -p "$OUT_DIR"

echo "=== GitHub events with commit details ==="
gh api "repos/ansforge/interop-IG-document-core/events?per_page=100" \
  --jq '.[] | select(.type=="PushEvent") | {
    time: .created_at,
    actor: .actor.login,
    branch: .payload.ref,
    num_commits: .payload.size,
    commits: [.payload.commits[]? | {sha: .sha[0:8], message: .message | split("\n")[0], author: .author.name}]
  }' | tee "$OUT_DIR/push-events-detail.json"

echo ""
echo "=== Commits per hour on NicolasRessourcesCDA (from events) ==="
gh api "repos/ansforge/interop-IG-document-core/events?per_page=100" \
  --jq '[.[] | select(.type=="PushEvent" and (.payload.ref | test("NicolasRessourcesCDA")))] |
    group_by(.created_at[0:13]) |
    .[] | "\(.[0].created_at[0:13]):00Z  pushes=\(length)  total_commits=\([.[].payload.size] | add)"' \
  2>/dev/null | tee "$OUT_DIR/nicolas-hourly-pushes.txt"

echo ""
echo "=== Issue opened by dotasek (David Otasek) about this ==="
gh api "repos/ansforge/interop-IG-document-core/issues?state=all&per_page=20&sort=updated&direction=desc" \
  --jq '.[] | "\(.number) \(.state) \(.created_at) @\(.user.login): \(.title)"' \
  2>/dev/null | tee "$OUT_DIR/recent-issues.txt"
