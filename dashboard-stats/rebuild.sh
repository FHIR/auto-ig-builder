#!/bin/bash
# Refresh the build statistics dashboard data. Steps (each can be run alone):
#   ./rebuild.sh pull       Cloud Logging (audit, container, preemptions) + public sources (qas.json, packages2)
#   ./rebuild.sh billing    daily cluster billing from BigQuery (guarded dry run; needs BILLING_EXPORT_TABLE)
#   ./rebuild.sh duckdb     raw pulls -> $IGSTATS_WORK/igstats.duckdb
#   ./rebuild.sh github     commits for the busiest repos (needs the duckdb; ~1-1.5 h, cached/resumable)
#   ./rebuild.sh egress     sampled web-server access-log aggregates (~25 min)
#   ./rebuild.sh disk       du scan of the upload volume via the ci-build pod (read-only, idle priority; NOT during a ci-build restart)
#   ./rebuild.sh sqlite     everything -> site/data/igstats.sqlite (what the page loads)
#   ./rebuild.sh all        all of the above, in order
#   ./rebuild.sh            = duckdb + sqlite from whatever is already in $IGSTATS_WORK
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$DS_HOME"
step() {
  case "$1" in
    pull)    pull/pull_logs.sh; pull/pull_public.sh ;;
    billing) pull/pull_billing.sh ;;
    duckdb)  rm -f "$IGSTATS_WORK/igstats.duckdb.tmp"
             (cd "$IGSTATS_WORK" && duckdb igstats.duckdb.tmp -c ".read $DS_HOME/build/build_duckdb.sql" -c ".read $DS_HOME/build/hl7_calendar.sql")
             mv "$IGSTATS_WORK/igstats.duckdb.tmp" "$IGSTATS_WORK/igstats.duckdb" ;;
    github)  pull/pull_github.sh ;;
    egress)  pull/pull_egress.sh ;;
    disk)    pull/disk_scan.sh ;;
    sqlite)  python3 build/build_sqlite.py ;;
    *) echo "unknown step $1" >&2; exit 2 ;;
  esac
}
if [ $# -eq 0 ]; then set -- duckdb sqlite; fi
if [ "$1" = all ]; then set -- pull billing duckdb github egress disk sqlite; fi
for s in "$@"; do echo "== $s" >&2; step "$s"; done
