#!/usr/bin/env python3
"""Sampled egress breakdown from the build.fhir.org Caddy access logs (read-only, Cloud Logging API).

Sample: the first SAMPLE_MIN minutes of every hour, over the given UTC days. Entries are streamed
and aggregated in memory; only aggregates are written (no IPs, no raw user agents, no headers).
Output NDJSON rows: {day, org, repo, branch, ftype, client, bot, status, n, bytes}
Usage: pull/pull_egress.sh [DAY DAY]   (default: the last two full UTC days)
"""
import collections, json, re, subprocess, sys, time, urllib.parse, urllib.request

SAMPLE_MIN = 1
import datetime as _dt
_today = _dt.datetime.now(_dt.timezone.utc).date()
days = sys.argv[1:] or [str(_today - _dt.timedelta(days=2)), str(_today - _dt.timedelta(days=1))]  # last two full UTC days
PROJECT = __import__("os").environ.get("GCP_PROJECT", "fhir-org-starter-project")
FIELDS = "timestamp,jsonPayload"  # nested masks are rejected; headers/IPs are dropped in memory below
BOTS = ["Googlebot", "bingbot", "GPTBot", "ClaudeBot", "Claude-User", "Amazonbot", "meta-externalagent", "PetalBot",
        "YandexBot", "AhrefsBot", "SemrushBot", "Bytespider", "CCBot", "DotBot", "Applebot", "PerplexityBot",
        "DataForSeoBot", "MJ12bot", "OAI-SearchBot", "ChatGPT-User", "BLEXBot", "Baiduspider", "DuckDuckBot",
        "facebookexternalhit", "SeznamBot", "Timpibot", "ImagesiftBot", "Barkrowler", "serpstatbot", "AwarioBot"]
TOOLS = ["curl", "Wget", "python-requests", "python-urllib", "aiohttp", "httpx", "Go-http-client", "okhttp", "Java/",
         "Apache-HttpClient", "node-fetch", "axios", "undici", "node", "HAPI-FHIR", "fhir", "Firely", "Ruby", "PostmanRuntime",
         "libwww-perl", "Dalvik", "Deno", "Bun/", "dotnet", "Microsoft.Net", "GitHub-Hookshot", "git/"]
EXT = {"html": "html", "htm": "html", "json": "json", "xml": "xml", "ttl": "ttl", "zip": "package/zip", "tgz": "package/zip",
       "gz": "package/zip", "png": "image", "jpg": "image", "jpeg": "image", "gif": "image", "svg": "image", "ico": "image",
       "css": "css/js", "js": "css/js", "woff": "font", "woff2": "font", "ttf": "font", "xlsx": "spreadsheet", "csv": "spreadsheet",
       "txt": "text", "md": "text", "pdf": "pdf", "map": "css/js"}

def classify(ua):
    if not ua: return "no user agent", ""
    low = ua.lower()
    for b in BOTS:
        if b.lower() in low: return "named bot", b
    if re.search(r"bot|crawl|spider|slurp|scrapy|fetcher|monitor", low): return "other bot", ""
    for t in TOOLS:
        if low.startswith(t.lower()) or t.lower() in low and "mozilla" not in low: return "tool / script", ""
    if "mozilla" in low: return "browser", ""
    return "tool / script", ""

def parse(uri):
    path = urllib.parse.urlsplit(uri or "/").path
    p = [x for x in path.split("/") if x]
    org = repo = branch = ""
    if len(p) >= 3 and p[0] == "ig":
        org, repo = p[1], p[2]
        branch = p[4] if len(p) >= 5 and p[3] == "branches" else "(default)"
    elif p and p[0] == "branches":
        org, repo, branch = "(core FHIR spec)", "branch builds", "(n/a)"
    elif p and p[0] == "ig":
        org, repo, branch = "(site)", "ig index", ""
    else:
        org, repo, branch = "(site)", "other", ""
    last = p[-1] if p else ""
    ext = last.rsplit(".", 1)[-1].lower() if "." in last else ""
    ftype = EXT.get(ext, "html" if ext == "" else "other")
    return org, repo, branch, ftype

def token():
    return subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()

agg = collections.defaultdict(lambda: [0, 0])
tok, t0, total = token(), time.time(), 0
for day in days:
    for hr in range(24):
        a = f"{day}T{hr:02d}:00:00Z"; b = f"{day}T{hr:02d}:{SAMPLE_MIN:02d}:00Z"
        body = {"resourceNames": ["projects/" + PROJECT], "orderBy": "timestamp asc", "pageSize": 1000,
                "filter": f'resource.type="k8s_container" AND resource.labels.container_name="caddy" AND timestamp>="{a}" AND timestamp<"{b}"'}
        url = "https://logging.googleapis.com/v2/entries:list?fields=nextPageToken," + urllib.parse.quote(f"entries({FIELDS})")
        while True:
            if time.time() - t0 > 2400: tok, t0 = token(), time.time()
            for attempt in range(8):
                try:
                    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
                    r = json.load(urllib.request.urlopen(req, timeout=120)); break
                except urllib.error.HTTPError as e:
                    if e.code == 429: time.sleep(20 * (attempt + 1)); continue
                    raise
            for e in r.get("entries", []):
                j = e.get("jsonPayload", {}); rq = j.get("request", {})
                ua = (rq.get("headers", {}).get("User-Agent") or [""])[0]
                client, bot = classify(ua)
                org, repo, branch, ftype = parse(rq.get("uri"))
                st = j.get("status") or 0
                k = (day, org, repo, branch, ftype, client, bot, f"{st // 100}xx")
                agg[k][0] += 1; agg[k][1] += int(j.get("size") or 0); total += 1
            if not r.get("nextPageToken"): break
            body["pageToken"] = r["nextPageToken"]; time.sleep(1.05)
        print(f"{day} {hr:02d}h: {total} entries so far", file=sys.stderr, flush=True)
for (day, org, repo, branch, ftype, client, bot, st), (n, by) in agg.items():
    print(json.dumps({"day": day, "org": org, "repo": repo, "branch": branch, "ftype": ftype, "client": client,
                      "bot": bot, "status": st, "n": n, "bytes": by, "sample_minutes_per_hour": SAMPLE_MIN}))
print(f"done: {total} entries, {len(agg)} aggregate rows", file=sys.stderr)
