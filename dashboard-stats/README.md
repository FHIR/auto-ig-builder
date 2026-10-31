# Build statistics dashboard

A public, single-page retrospective of the IG auto-builds: volume, who builds, outcomes, durations, time
patterns, the HL7 calendar, contributors, cost and disk.

**Live:** https://build.fhir.org/ig/_dashboard/

The page is static. The browser downloads one SQLite file (`site/data/igstats.sqlite`, about 6 MB) and runs
every chart as a live SQL query against it with [sql.js](https://github.com/sql-js/sql.js) (vendored in
`site/vendor/`, v1.10.3). Every chart is a filter; filter state lives in the URL hash.

```
dashboard-stats/
  env.sh, config.example.env   settings; copy config.example.env to config.env (git-ignored)
  rebuild.sh                   refresh pipeline (pull -> DuckDB -> SQLite), step by step or all
  deploy.sh                    publish site/ to build.fhir.org/ig/_dashboard/
  pull/                        data pulls (Cloud Logging, BigQuery, GitHub, packages2, access-log sample, disk scan)
  build/                       build_duckdb.sql, hl7_calendar.sql (hand-curated, approximate), build_sqlite.py, schema.sql (tables + cost views)
  site/                        the page: index.html, app.js, charts.js, queries.js (all chart SQL), vendor/sql.js
  test/smoke_test.mjs          headless-Chromium check over CDP
  work/                        raw pulls, caches, DuckDB (git-ignored; override with IGSTATS_WORK)
```

## Prerequisites

- `gcloud` authenticated (`gcloud auth login`) with read access in `fhir-org-starter-project` to
  Cloud Logging (`roles/logging.viewer`, incl. the admin-activity audit log), BigQuery (`roles/bigquery.jobUser`
  plus read on the billing-export dataset) and Compute (for preemption events, via Logging).
- `kubectl` context for the `fhir-k8s` cluster (`KUBE_CONTEXT`, default `gke_fhir-org-starter-project_us-east1-d_fhir-k8s`)
  with `exec` on the `ci-build` pod (disk scan and deploy only).
- `gh auth login` (any account; public API reads only, 5,000 requests/hour).
- Python 3.11+ (standard library only), DuckDB CLI 1.1+ (tested with 1.5), `jq`, `curl`, Node 22+ and Chromium for the smoke test.
- `config.env` with `BILLING_EXPORT_TABLE` set to the resource-level billing export table
  (`<project>.<dataset>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`). The table name embeds the
  billing-account id, so it lives only in the git-ignored `config.env` (or the environment), never in the repo.

## Refresh, deploy, verify

```sh
cd dashboard-stats
cp config.example.env config.env && $EDITOR config.env    # once
./rebuild.sh pull       # Cloud Logging: audit log, ig-upload lines, preemptions; plus qas.json and packages2 (~20-25 min)
./rebuild.sh billing    # BigQuery dry run first, then the query (refuses > 2 GB; ~1.2 GB as of Oct 2026)
./rebuild.sh duckdb     # raw pulls -> work/igstats.duckdb (~1 min)
./rebuild.sh github     # commits for the 150 busiest repos, two workers (~1-1.5 h first time; cached and resumable)
./rebuild.sh egress     # access-log sample: first minute of each hour, last two full UTC days (~25 min)
./rebuild.sh disk       # du of the upload volume via the ci-build pod (see below; can take an hour or more)
./rebuild.sh sqlite     # -> site/data/igstats.sqlite (~1 min)
# or: ./rebuild.sh all

python3 -m http.server -d site 8000     # optional local look
node test/smoke_test.mjs http://localhost:8000/

./deploy.sh                             # publish (public!)
node test/smoke_test.mjs                # verify https://build.fhir.org/ig/_dashboard/
```

Monthly log files already in `work/` are skipped except the last (partial) month, and GitHub results are cached
per repo and branch, so a routine refresh is mostly the log tail, billing, egress and the scan. The window starts
at `WINDOW_START` (default 2025-09-01); audit logs are kept about 400 days and container logs about 366, so move
it forward as time passes. A full refresh from an empty `work/` takes roughly 2.5-3.5 hours, dominated by the
GitHub pull and the disk scan. BigQuery cost is one query scanning about 1.2 GB (well under a cent at on-demand
pricing); Cloud Logging and GitHub reads are free within quota.

The smoke test loads the page at phone size, clicks through filters (class, treemap drill-down, heatmap,
timeline zoom, contributor, cost drill, QA bucket), checks that the URL hash restores state after a reload,
that the unfiltered total matches the database, and that there are no console errors.

### Disk scan

`pull/disk_scan.sh` execs into the running `ci-build` pod as `fhir_upload` and runs `df` and
`ionice -c3 nice -n19 du -k -d 6` over `~/uploading`: read-only, idle I/O and CPU priority, output trimmed to
org, repo and branch folders. **Do not run it while ci-build is restarting or being redeployed**; it refuses if a
ci-build pod is terminating or not Ready, but don't rely on that alone. After a resize or cleanup you can record
the new volume state without rescanning by writing `work/disk/disk_now.json`
(`{"date","size_tb","used_pct","free_gib","source"}`); the page then shows it as current next to the dated scan.

## Privacy: what must never be in the database

The SQLite file is public. `build/build_sqlite.py` copies only what the page needs:

- **Never:** email addresses or commit author names (GitHub logins only, bots flagged); IP addresses, user-agent
  strings or request headers (the access-log sample is aggregated in memory into org/repo/branch, file type and
  client class); pod, job, node or VM instance names; GCP project numbers and billing-account ids; raw log lines;
  tokens or secret names; anything from outside the IG-build statistics.
- The raw pulls in `work/` do contain job and pod names and similar operational detail; they stay local and
  git-ignored. Never commit `work/`, `config.env` or any `.sqlite`/`.duckdb`.

Before deploying a changed schema, dump the database and grep it for `@`, IP-address patterns and the
project/billing identifiers.
