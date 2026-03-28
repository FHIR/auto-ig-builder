#!/bin/bash
# Fetch commit history for branches of interest
# The NicolasRessourcesCDA branch was deleted, but we can check merged PRs and remaining branches
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT/out"
mkdir -p "$OUT_DIR"

echo "=== All branches ==="
gh api "repos/ansforge/interop-IG-document-core/branches?per_page=100" --jq '.[].name' | tee "$OUT_DIR/branches.txt"

echo ""
echo "=== Recent closed PRs (may show merged NicolasRessourcesCDA) ==="
gh api "repos/ansforge/interop-IG-document-core/pulls?state=closed&per_page=20&sort=updated&direction=desc" \
  --jq '.[] | "\(.number) \(.state) merged=\(.merged_at // "no") \(.head.ref) -> \(.base.ref) \(.title)"' \
  | tee "$OUT_DIR/closed-prs.txt"

echo ""
echo "=== Recent commits on main (last 30) ==="
gh api "repos/ansforge/interop-IG-document-core/commits?sha=main&per_page=30" \
  --jq '.[] | "\(.commit.author.date) \(.sha[0:8]) \(.commit.author.name): \(.commit.message | split("\n")[0])"' \
  | tee "$OUT_DIR/main-commits.txt"

echo ""
echo "=== fusionRessourcesCDA branch commits (last 50) ==="
gh api "repos/ansforge/interop-IG-document-core/commits?sha=fusionRessourcesCDA&per_page=50" \
  --jq '.[] | "\(.commit.author.date) \(.sha[0:8]) \(.commit.author.name): \(.commit.message | split("\n")[0])"' \
  2>/dev/null | tee "$OUT_DIR/fusionRessourcesCDA-commits.txt" || echo "(branch may not exist)"

echo ""
echo "=== Looking for NicolasRessourcesCDA in PR history ==="
gh api "repos/ansforge/interop-IG-document-core/pulls?state=all&per_page=50&head=ansforge:NicolasRessourcesCDA" \
  --jq '.[] | "\(.number) state=\(.state) merged=\(.merged_at // "no") \(.head.ref) \(.title) commits=\(.commits)"' \
  2>/dev/null | tee "$OUT_DIR/nicolas-prs.txt" || echo "(no matching PRs found)"
