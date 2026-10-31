#!/usr/bin/env python3
"""Read-only BigQuery query via REST, guarded by a dry run.
Usage: bq.py [--run] [--max-gb N] SQL_FILE > out.ndjson
${VARS} in the SQL are filled from the environment (e.g. ${BILLING_EXPORT_TABLE}); unset ones abort.
Without --run only the dry run happens (prints bytes that would be scanned). --run refuses > --max-gb (default 2)."""
import json, os, re, subprocess, sys, urllib.request
args = sys.argv[1:]; run = "--run" in args
max_gb = float(args[args.index("--max-gb") + 1]) if "--max-gb" in args else 2.0
path = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--max-gb")][0]
sql = open(path).read()
missing = [v for v in re.findall(r"\$\{(\w+)\}", sql) if not os.environ.get(v)]
if missing: sys.exit(f"set {', '.join(sorted(set(missing)))} (see config.example.env)")
sql = re.sub(r"\$\{(\w+)\}", lambda m: os.environ[m.group(1)], sql)
tok = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
P = os.environ.get("GCP_PROJECT", "fhir-org-starter-project")
def call(body):
    req = urllib.request.Request(f"https://bigquery.googleapis.com/bigquery/v2/projects/{P}/queries", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))
gb = int(call({"query": sql, "useLegacySql": False, "dryRun": True})["totalBytesProcessed"]) / 1e9
print(f"dry run: {gb:.3f} GB", file=sys.stderr)
if run:
    if gb > max_gb: sys.exit(f"refusing: {gb:.2f} GB > {max_gb} GB")
    r = call({"query": sql, "useLegacySql": False, "timeoutMs": 120000, "maxResults": 100000})
    if not r.get("jobComplete", True) or r.get("pageToken"): sys.exit("result incomplete or paged; narrow the query")
    names = [f["name"] for f in r["schema"]["fields"]]
    for row in r.get("rows", []):
        print(json.dumps(dict(zip(names, [c["v"] for c in row["f"]]))))
