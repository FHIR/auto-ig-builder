#!/usr/bin/env python3
"""Build site/data/igstats.sqlite (the browser database) from $IGSTATS_WORK: the DuckDB stats DB,
daily billing, the cached GitHub commit pull, the egress sample and the disk scan.  Everything is read-only toward the sources.

What goes in is deliberately narrow (see SENSITIVE below and README): no emails, no IPs, no
pod/job/node/instance names, no GCP project or billing-account ids, no raw log lines.
Usage: ../rebuild.sh (or python3 build/build_sqlite.py with IGSTATS_WORK set)
"""
import argparse, calendar, csv, glob, json, os, re, sqlite3, subprocess, sys, tempfile, time
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__)); DS = os.path.dirname(HERE)
W = os.environ.get("IGSTATS_WORK") or os.path.join(DS, "work")
S = W
ap = argparse.ArgumentParser()
ap.add_argument("--db", default=os.path.join(W, "igstats.duckdb"))
ap.add_argument("--gh", default=os.path.join(W, "gh_commits"))
ap.add_argument("--du", default=os.path.join(W, "disk", "du-kib.tsv"))
ap.add_argument("--out", default=os.path.join(DS, "site", "data", "igstats.sqlite"))
a = ap.parse_args()

os.makedirs(os.path.join(W, "tmp"), exist_ok=True)
tmp = tempfile.mkdtemp(prefix="igsqlite-", dir=os.path.join(W, "tmp"))

def duck(sql):
    r = subprocess.run(["duckdb", "-readonly", a.db, "-c", sql], capture_output=True, text=True)
    if r.returncode: sys.exit(f"duckdb: {r.stderr}\n{sql[:400]}")

def export(name, sql):
    """Run a DuckDB query and return rows (via CSV, header row dropped)."""
    f = os.path.join(tmp, name + ".csv")
    duck(f"set TimeZone='UTC'; copy ({sql}) to '{f}' (header, delimiter ',');")
    with open(f, newline="") as fh:
        rows = list(csv.reader(fh))
    return rows[0], rows[1:]

# Org classes, as in the DB's org_class macro, with friendlier labels.
CLS = """case org_class(org) when 'HL7 International' then 'HL7 International'
  when 'HL7 affiliate' then 'HL7 affiliates' when 'IHE' then 'IHE'
  when 'FHIR/HL7 community' then 'FHIR community' else 'Everyone else' end"""
# Regions: assigned by hand ONLY for orgs that are identifiable national/regional bodies.
EUROPE = ["ansforge", "hl7-eu", "HL7Austria", "Nictiz", "medcomdk", "hl7-be", "HL7-cz", "hl7ch",
          "Interop-Sante", "TEHIK-EE", "HL7LT", "IKNL", "medizininformatik-initiative", "nuts-foundation",
          "ehealthsuisse", "RIVO-Noord", "hl7-pt", "bvdh", "bag-epl"]
APAC = ["hl7au", "TWNHIFHIR", "tewhatuora", "HL7NZ"]

# --- build requests (a/b siblings merged) with their outcome -----------------------------------
REQ_SQL = f"""
with c0 as (select job, ts, org, repo, branch, lag(ts) over (partition by org, repo, branch order by ts) prev from creates),
c as (select *, sum(case when prev is null or ts - prev > interval 5 second then 1 else 0 end)
        over (partition by org, repo, branch order by ts rows unbounded preceding) rq from c0),
pm as (select p.started, p.minutes, p.upload_mb, p.errors, p.f.status st, c.org, c.repo, c.branch, c.rq
       from builds p asof join c on p.job = c.job and p.started >= c.ts
       where p.started - c.ts < interval 3 hour),
r as (select org, repo, branch, rq, min(ts) ts from c group by all),
o as (select org, repo, branch, rq, count(*) pods,
        bool_or(st = 'success') ok, bool_or(st = 'failure') bad,
        coalesce(min(minutes) filter (where st = 'success'), min(minutes) filter (where st = 'failure')) as "minutes",
        max(upload_mb) filter (where st = 'success') upload_mb,
        min(errors) filter (where st = 'success') errors
      from pm group by all)
select r.org, r.repo, r.branch, epoch(r.ts)::bigint ts,
  case when o.ok then 'success' when o.bad then 'failure'
       when r.ts < (select min(started) from builds) then 'no logs' else 'no result' end outcome,
  round(o.minutes, 2) as "minutes", round(o.upload_mb, 1) upload_mb, o.errors
from r left join o using (org, repo, branch, rq) order by r.ts"""
hdr, reqs = export("req", REQ_SQL)
print("requests", len(reqs))
_, orgcls = export("orgcls", f"select distinct org, {CLS} cls from creates")

# --- open sqlite ----------------------------------------------------------------------------------
os.makedirs(os.path.dirname(a.out), exist_ok=True)
if os.path.exists(a.out): os.remove(a.out)
db = sqlite3.connect(a.out)
db.executescript(open(os.path.join(HERE, "schema.sql")).read())

cls_of = dict(orgcls)
CLASSES = ["HL7 International", "HL7 affiliates", "IHE", "FHIR community", "Everyone else"]
orgs, repos, branches = {}, {}, {}
def org_id(o):
    if o not in orgs:
        orgs[o] = len(orgs) + 1
        reg = "Europe" if o in EUROPE else "Asia-Pacific" if o in APAC else None
        db.execute("insert into orgs values (?,?,?,?)", (orgs[o], o, CLASSES.index(cls_of.get(o, "Everyone else")) + 1, reg))
    return orgs[o]
def repo_id(o, r):
    k = (o.lower(), r.lower())
    if k not in repos:
        repos[k] = len(repos) + 1
        db.execute("insert into repos (id, org_id, name) values (?,?,?)", (repos[k], org_id(o), r))
    return repos[k]
def branch_id(o, r, b):
    k = (o.lower(), r.lower(), b)
    if k not in branches:
        branches[k] = len(branches) + 1
        kind = 1 if b in ("main", "master") else 2
        db.execute("insert into branches (id, repo_id, name, kind) values (?,?,?,?)", (branches[k], repo_id(o, r), b, kind))
    return branches[k]

db.executemany("insert into classes values (?,?)", [(i + 1, c) for i, c in enumerate(CLASSES)])
OUT = {"success": 1, "failure": 2, "no result": 3, "no logs": 4}
db.executemany("insert into outcomes values (?,?)", [(v, k) for k, v in OUT.items()])
db.executemany("insert into kinds values (?,?)", [(1, "main/master"), (2, "other branch")])

ET = ZoneInfo("America/New_York")
def et_parts(ts):
    e = datetime.fromtimestamp(ts, ET)
    return e.isoweekday(), e.hour

rows = []
for org, repo, br, ts, outcome, minutes, mb, errors in reqs:
    ts = int(ts); t = time.gmtime(ts)
    dow_et, hour_et = et_parts(ts)
    oid = org_id(org); rid = repo_id(org, repo); bid = branch_id(org, repo, br)
    rows.append((ts, oid, rid, bid, 1 if br in ("main", "master") else 2,
                 db.execute("select cls from orgs where id=?", (oid,)).fetchone()[0], OUT[outcome],
                 float(minutes) if minutes else None, float(mb) if mb else None, int(errors) if errors else None,
                 t.tm_wday + 1, t.tm_hour, dow_et, hour_et))
db.executemany("""insert into builds (ts, org_id, repo_id, branch_id, kind, cls, outcome, minutes, upload_mb, errors,
  dow, hour, dow_et, hour_et) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)

# --- QA snapshot per branch (qas.json) ---------------------------------------------------------------
_, qas = export("qas", """select org, repo_name, branch, version, errs, warnings, round(maxMemory / 2^30, 2) mem_gib,
   strftime(dt, '%Y-%m-%d') d from qas where org is not null and repo_name is not null and branch is not null""")
FV = lambda v: "R4" if v.startswith("4.0") else "R5" if v.startswith("5.0") else "R6 (pre-release)" if v.startswith("6.0") \
    else "STU3" if v.startswith("3.") else "R4B / R5 drafts" if v.startswith("4.") else "Other"
for org, repo, br, v, e, w, mem, d in qas:
    bid = branch_id(org, repo, br)
    db.execute("update branches set fhir=?, qa_errs=?, qa_warnings=?, qa_mem_gib=?, qa_date=? where id=?",
               (FV(v or ""), int(e) if e else None, int(w) if w else None, float(mem) if mem else None, d or None, bid))

# --- commits (GitHub, cached pull; logins only) ---------------------------------------------------
people, seen = {}, set()
covered = set()
def person(login, is_bot):
    if login not in people:
        people[login] = len(people) + 1
        db.execute("insert into people values (?,?,?)", (people[login], login, int(is_bot)))
    return people[login]
BOT = re.compile(r"(\[bot\]$|^dependabot|^github-actions|^renovate|-bot$|^copilot)", re.I)
for f in sorted(glob.glob(os.path.join(a.gh, "*__meta.json"))):
    m = json.load(open(f))
    if "error" in m: continue
    full = m["full_name"]; o, r = full.split("/", 1)
    k = (o.lower(), r.lower())
    base = os.path.basename(f)[:-len("__meta.json")]
    rid = repos.get(k)
    if rid is None:  # renamed repo: fall back to the name we queried
        qo, qr = base.split("__", 1); rid = repos.get((qo.lower(), qr.lower()))
    if rid is None: continue
    covered.add(rid)
    db.execute("update repos set gh_default_branch=?, gh_covered=1 where id=?", (m["default_branch"], rid))
    for cf in glob.glob(os.path.join(a.gh, base + "__*.ndjson")):
        lines = open(cf).read().split("\n")
        for ln in lines[1:]:
            if not ln.strip(): continue
            c = json.loads(ln)
            if (rid, c["sha"]) in seen: continue
            seen.add((rid, c["sha"]))
            login = c.get("login")
            is_bot = bool(login and (c.get("type") == "Bot" or BOT.search(login)))
            pid = person(login, is_bot) if login else None
            ts = calendar.timegm(time.strptime(c["date"], "%Y-%m-%dT%H:%M:%SZ"))
            db.execute("insert into commits (repo_id, person_id, ts) values (?,?,?)", (rid, pid, ts))
print("commits", len(seen), "people", len(people), "repos covered", len(covered))

# --- calendar, billing, preemptions, packages ---------------------------------------------------
_, cal = export("cal", """select kind, label, strftime("start", '%Y-%m-%d'), strftime("end", '%Y-%m-%d'), confidence, source from hl7_calendar""")
db.executemany("insert into calendar values (?,?,?,?,?,?)", cal)
bill_f = os.path.join(S, "billing_cluster_daily.ndjson"); skus = {}
for l in open(bill_f):
    r = json.loads(l)
    sk = skus.setdefault(r["sku"], len(skus) + 1)
    db.execute("insert into billing_daily values (?,?,?,?,?,?)", (r["day"], r["pool"], r["service"], sk, r["cls"], float(r["cost"])))
db.executemany("insert into skus values (?,?)", [(v, k) for k, v in skus.items()])
_, pre = export("pre", "select strftime(ts::date, '%Y-%m-%d'), count(*) from preemptions group by 1")
db.executemany("insert into preemptions_daily values (?,?)", [(d, int(n)) for d, n in pre])
_, pk = export("pk", "select name, version, strftime(t, '%Y-%m-%d') from pkg_versions")
db.executemany("insert into pkg_versions values (?,?,?)", pk)

# --- disk ----------------------------------------------------------------------------------------
disk_dir = os.path.dirname(a.du)
sd_f = os.path.join(disk_dir, "scan_date")
SCAN_DATE = open(sd_f).read().strip() if os.path.exists(sd_f) else time.strftime("%Y-%m-%d", time.gmtime(os.path.getmtime(a.du)))
du = {p: int(k) for k, p in (l.rstrip("\n").split("\t") for l in open(a.du) if l.strip())}
bcount = {}
for p in du:
    s_ = p.split("/")
    if len(s_) == 7 and s_[1:3] == ["www", "ig"] and s_[5] == "branches":
        bcount[(s_[3], s_[4])] = bcount.get((s_[3], s_[4]), 0) + 1
for p, k in du.items():
    s_ = p.split("/")
    if len(s_) == 5 and s_[1:3] == ["www", "ig"]:
        db.execute("insert into disk_by_repo values (?,?,?,?,?,?)", (SCAN_DATE + " scan", s_[3], s_[4], round(k / 2**20, 3), bcount.get((s_[3], s_[4]), 0), repos.get((s_[3].lower(), s_[4].lower()))))
db.execute("insert into disk_by_repo values (?,?,?,?,?,?)", (SCAN_DATE + " scan", "(core FHIR spec)", "branch builds", round(du.get("./www/branches", 0) / 2**20, 3), None, None))
df = [l.split() for l in open(os.path.join(disk_dir, "df.txt")) if l.strip()][-1]
df = df[-5:] if len(df) >= 5 else df  # size used avail use% mount (filesystem name may wrap)
db.execute("insert into disk_volume values (?,?,?,?,?,?)", (SCAN_DATE + " scan", round(int(df[0]) / 2**20), round(int(df[1]) / 2**20), round(int(df[2]) / 2**20), int(df[3].rstrip("%")), "df on the upload volume, taken with the du scan"))
now_f = os.path.join(disk_dir, "disk_now.json")  # optional manual override, e.g. after a resize: {"date","size_tb","used_pct","free_gib","source"}
if os.path.exists(now_f):
    now = json.load(open(now_f))
    db.execute("insert into disk_volume values (?,?,?,?,?,?)", (now["date"] + " current", round(now["size_tb"] * 1e12 / 2**30), None, now["free_gib"], now["used_pct"], now["source"]))

# --- egress sample (aggregates from pull/caddy_sample.py) --------------------------------------------
eg_f = os.path.join(S, "caddy", "agg.ndjson")
if os.path.exists(eg_f):
    known_br = {}
    for (o, r, b), bid in branches.items(): known_br.setdefault((o, r), set()).add(b)
    org_lc = {o.lower(): o for o in orgs}
    agg = {}; days_seen = set(json.loads(l)["day"] for l in open(eg_f))
    for l in open(eg_f):
        e = json.loads(l)
        o, r, b = e["org"], e["repo"], e["branch"]
        if not o.startswith("("):
            rid = repos.get((o.lower(), r.lower()))
            if rid is None: o, r, b = (org_lc.get(o.lower(), "(unknown path)"), "(unknown repo)" if o.lower() in org_lc else "", "")
            elif b != "(default)" and b not in known_br.get((o.lower(), r.lower()), ()): b = "(other branch)"
        else: rid = None
        k = ("+".join(sorted(days_seen)), o, r, b, e["ftype"], e["client"], e["bot"], "ok" if e["status"] in ("2xx", "3xx") else "error", e["sample_minutes_per_hour"], rid if not o.startswith("(") else None)
        a2 = agg.setdefault(k, [0, 0]); a2[0] += e["n"]; a2[1] += e["bytes"]
    # keep branch detail only where it carries real traffic (>= 1 MB in the sample); fold the rest
    br_bytes = {}
    for k, (n, by) in agg.items(): br_bytes[(k[9], k[3])] = br_bytes.get((k[9], k[3]), 0) + by
    agg2 = {}
    for k, (n, by) in agg.items():
        if k[9] is not None and k[3] not in ("(default)",) and br_bytes[(k[9], k[3])] < 1e6: k = k[:3] + ("(other branch)",) + k[4:]
        a2 = agg2.setdefault(k, [0, 0]); a2[0] += n; a2[1] += by
    agg = agg2
    for k, (n, by) in agg.items():
        db.execute("insert into egress_sample values (?,?,?,?,?,?,?,?,?,?,?,?)", (*k[:8], n, by, k[8], k[9]))
    print("egress_sample rows", len(agg))

# --- meta ---------------------------------------------------------------------------------------
_, mt = export("meta", """select strftime(min(ts), '%Y-%m-%d %H:%M'), strftime(max(ts), '%Y-%m-%d %H:%M'),
  (select strftime(min(started), '%Y-%m-%d') from builds), (select strftime(min(ts), '%Y-%m-%d') from creates where regexp_matches(job, '-[ab]$')),
  count(*) from creates""")
first, last, logs_first, ab_first, launches = mt[0]
for k, v in {"first_ts": first, "last_ts": last, "logs_first": logs_first, "ab_first": ab_first, "job_launches": launches,
             "disk_scan": SCAN_DATE, "built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
             "gh_window": os.environ.get("WINDOW_START", "") + ".." + os.environ.get("WINDOW_END", ""), "gh_repos": str(len(covered))}.items():
    db.execute("insert into meta values (?,?)", (k, v))

db.commit()
db.executescript(open(os.path.join(HERE, "indexes.sql")).read())
db.execute("analyze"); db.commit(); db.execute("vacuum"); db.close()
print(f"wrote {a.out} ({os.path.getsize(a.out) / 1e6:.2f} MB)")
