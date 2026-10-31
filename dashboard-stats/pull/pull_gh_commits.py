#!/usr/bin/env python3
"""Read-only GitHub pull: commits in the build window for the busiest built repos.

For the top N repos by distinct build requests: the default branch plus every built branch
that still exists. Results are cached per (repo, branch) as NDJSON with email addresses
dropped (sha, author login/type, author name, date, committer login) under
$IGSTATS_WORK/gh_commits/. Rerunning skips cached files.
Usage: pull/pull_github.sh  (wraps this with env.sh; add --top N / --reverse for a second parallel worker)
"""
import argparse, hashlib, json, os, subprocess, sys, time, urllib.parse

ap = argparse.ArgumentParser()
ap.add_argument("--top", type=int, default=150)
ap.add_argument("--reverse", action="store_true", help="walk the list from the end (for a second parallel worker)")
W = os.environ.get("IGSTATS_WORK") or sys.exit("run via pull/pull_github.sh (needs IGSTATS_WORK)")
ap.add_argument("--db", default=os.path.join(W, "igstats.duckdb"))
ap.add_argument("--out", default=os.path.join(W, "gh_commits"))
ap.add_argument("--since", default=os.environ.get("WINDOW_START", "2025-09-01") + "T00:00:00Z")
ap.add_argument("--until", default=os.environ.get("WINDOW_END", "2026-11-01") + "T00:00:00Z")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

sql = f"""with c as (select org, repo, branch, ts, lag(ts) over (partition by org, repo, branch order by ts) prev from creates),
 r as (select org, repo, count(*) filter (where prev is null or ts - prev > interval 5 second) n from c group by 1, 2 order by n desc limit {a.top})
select r.org, r.repo, r.n, to_json(list(distinct c.branch)) branches from r join c using (org, repo) group by all order by r.n desc"""
repos = json.loads(subprocess.run(["duckdb", "-readonly", "-json", a.db, "-c", sql], capture_output=True, text=True, check=True).stdout)
for r in repos: r["branches"] = json.loads(r["branches"]) if isinstance(r["branches"], str) else r["branches"]

calls = 0
def gh(path, jq=None, paginate=False):
    global calls
    calls += 1
    if calls % 40 == 0:
        rl = json.loads(subprocess.run(["gh", "api", "rate_limit"], capture_output=True, text=True).stdout)["resources"]["core"]
        if rl["remaining"] < 300:
            wait = max(0, rl["reset"] - time.time()) + 5
            print(f"rate limit low ({rl['remaining']}); sleeping {wait:.0f}s", flush=True); time.sleep(wait)
    cmd = ["gh", "api", path] + (["--paginate"] if paginate else []) + (["--jq", jq] if jq else [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

JQ = ('.[] | {sha, login: .author.login, type: .author.type, name: .commit.author.name, '
      'date: .commit.author.date, committer: .committer.login}')
summary = []
order = list(enumerate(repos))
if a.reverse: order.reverse()
for i, r in order:
    full = f"{r['org']}/{r['repo']}"
    meta_f = os.path.join(a.out, f"{r['org']}__{r['repo']}__meta.json")
    if os.path.exists(meta_f):
        meta = json.load(open(meta_f))
    else:
        code, out, err = gh(f"repos/{full}", jq="{full_name, default_branch, private, archived}")
        if code != 0:
            meta = {"error": err.strip()[:200]}
        else:
            meta = json.loads(out)
            code, out, err = gh(f"repos/{full}/branches?per_page=100", jq=".[].name", paginate=True)
            meta["branches"] = out.split("\n")[:-1] if code == 0 else []
        json.dump(meta, open(meta_f, "w"))
    if "error" in meta:
        print(f"[{i+1}/{len(repos)}] {full}: {meta['error']}", flush=True); continue
    want = [meta["default_branch"]] + sorted(set(r["branches"]) & set(meta["branches"]) - {meta["default_branch"]})
    got = 0
    for b in want:
        key = hashlib.sha1(f"{full}@{b}".encode()).hexdigest()[:12]
        f = os.path.join(a.out, f"{r['org']}__{r['repo']}__{key}.ndjson")
        if not os.path.exists(f):
            q = urllib.parse.urlencode({"sha": b, "since": a.since, "until": a.until, "per_page": 100})
            code, out, err = gh(f"repos/{full}/commits?{q}", jq=JQ, paginate=True)
            if code != 0 and "409" not in err:  # 409 = empty repo
                print(f"  {full}@{b}: {err.strip()[:120]}", flush=True); continue
            with open(f + f".tmp{os.getpid()}", "w") as fh:
                fh.write(json.dumps({"_branch": b, "_repo": full, "_default": b == meta["default_branch"]}) + "\n" + out)
            os.replace(f + f".tmp{os.getpid()}", f)
        got += 1
    print(f"[{i+1}/{len(repos)}] {full}: {got}/{len(want)} branches (built {len(r['branches'])})", flush=True)
print("done; api calls this run:", calls)
