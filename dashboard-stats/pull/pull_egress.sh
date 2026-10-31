#!/bin/bash
# Sampled egress mix from the web server (Caddy) access logs: first minute of every hour over two UTC days.
# Aggregated in memory; only org/repo/branch/file-type/client-class aggregates are written (no IPs, no user agents).
# ~25 min (about 240k log entries at the Logging API read quota).
set -euo pipefail
. "$(dirname "$0")/../env.sh"
mkdir -p "$IGSTATS_WORK/caddy"
python3 "$DS_HOME/pull/caddy_sample.py" "$@" > "$IGSTATS_WORK/caddy/agg.ndjson.tmp"
mv "$IGSTATS_WORK/caddy/agg.ndjson.tmp" "$IGSTATS_WORK/caddy/agg.ndjson"
