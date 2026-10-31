#!/bin/bash
# Commits (read-only GitHub API via `gh`) for the busiest built repos: default branch + every built branch that still exists.
# Needs the DuckDB (run ../rebuild.sh --duckdb-only first). Cached per repo/branch; rerun resumes. ~1-1.5 h for 150 repos
# with two workers (~2,000 API calls, under the 5,000/h limit). Delete $IGSTATS_WORK/gh_commits to start fresh.
set -euo pipefail
. "$(dirname "$0")/../env.sh"
TOP="${GH_TOP:-150}"
python3 "$DS_HOME/pull/pull_gh_commits.py" --top "$TOP" "$@" &
python3 "$DS_HOME/pull/pull_gh_commits.py" --top "$TOP" --reverse "$@" > "$IGSTATS_WORK/gh_commits_rev.log" 2>&1 &
wait
