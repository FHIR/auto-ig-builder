#!/bin/bash
# Daily cluster billing via the guarded BigQuery helper (dry run first; ~1.2 GB scanned as of Oct 2026).
set -euo pipefail
. "$(dirname "$0")/../env.sh"
python3 "$DS_HOME/pull/bq.py" "$DS_HOME/pull/billing_cluster_daily.sql"
python3 "$DS_HOME/pull/bq.py" --run "$DS_HOME/pull/billing_cluster_daily.sql" > "$IGSTATS_WORK/billing_cluster_daily.ndjson.tmp"
mv "$IGSTATS_WORK/billing_cluster_daily.ndjson.tmp" "$IGSTATS_WORK/billing_cluster_daily.ndjson"
