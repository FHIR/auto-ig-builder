// Every chart on the page is one (or two) of these SQL queries, run live in the browser by sql.js.
// Placeholders, filled from the global filter state:
//   [W]  -> written as the marker W between slash-star comment delimiters: extra "and ..." conditions on builds b
//   [C]  -> likewise for commits c (org/repo/date/contributor filters only)
//   {BUCKET} {DOW} {HOUR} {IDS} {DISKW}: time bucket / day-of-week / hour columns / id list / disk filter
// Tables: see scripts/schema.sql. builds = one row per distinct build request.
"use strict";
const Q = {
  kpi: `select count(*) n, count(distinct b.org_id) orgs, count(distinct b.repo_id) repos, count(distinct b.branch_id) branches,
      sum(b.outcome = 1) ok, sum(b.outcome = 2) bad, sum(b.outcome = 3) nores, sum(b.outcome = 4) nologs,
      sum(b.upload_mb) / 1048576.0 tb, count(b.upload_mb) nsize, sum(b.minutes) / 60.0 hours,
      min(b.ts) t0, max(b.ts) t1, sum(b.dow >= 6) weekend
    from builds b where 1=1 /*W*/`,
  median_minutes: `with x as (select b.minutes m from builds b where b.minutes is not null /*W*/)
    select m from x order by m limit 1 offset (select count(*) / 2 from x)`,

  // Timeline: build requests per month / week / day, stacked by org class
  timeline: `select {BUCKET} k, b.cls, count(*) n from builds b where 1=1 /*W*/ group by 1, 2 order by 1`,
  classes: `select c.id, c.name, count(b.id) n from classes c left join builds b on b.cls = c.id /*W*/ group by c.id order by c.id`,
  top_orgs: `select o.name org, o.cls, count(*) n, count(distinct b.repo_id) repos from builds b join orgs o on o.id = b.org_id
    where 1=1 /*W*/ group by o.id order by n desc limit 15`,

  // Treemap levels
  tm_repos: `select r.id, o.name org, r.name repo, o.cls, count(*) n, sum(b.minutes) / 60.0 hrs
    from builds b join repos r on r.id = b.repo_id join orgs o on o.id = r.org_id where 1=1 /*W*/ group by r.id order by n desc`,
  tm_branches: `select br.id, br.name, br.kind, count(*) n, sum(b.minutes) / 60.0 hrs
    from builds b join branches br on br.id = b.branch_id where 1=1 /*W*/ group by br.id order by n desc`,
  repo_minutes: `select b.repo_id, b.minutes from builds b where b.minutes is not null /*W*/ and b.repo_id in ({IDS})`,

  outcomes: `select x.id, x.name, count(b.id) n from outcomes x left join builds b on b.outcome = x.id /*W*/ group by x.id order by x.id`,
  fail_monthly: `select strftime('%Y-%m', b.ts, 'unixepoch') m, sum(b.outcome = 2) bad, sum(b.outcome in (1, 2)) n
    from builds b where 1=1 /*W*/ group by 1 having n > 0 order by 1`,
  dur_hist: `select min(cast(b.minutes as int), 40) bin, sum(b.outcome = 1) ok, sum(b.outcome = 2) bad
    from builds b where b.minutes is not null /*W*/ group by 1 order by 1`,
  size_hist: `select min(cast(b.upload_mb / 25 as int) * 25, 600) bin, count(*) n
    from builds b where b.upload_mb is not null /*W*/ group by 1 order by 1`,

  // Time patterns
  heat: `select {DOW} d, {HOUR} hr, count(*) n from builds b where 1=1 /*W*/ group by 1, 2`,
  region_hours: `select case when o.name = 'HL7' then 'HL7 International' else o.region end grp, b.hour hr, count(*) n
    from builds b join orgs o on o.id = b.org_id where (o.region is not null or o.name = 'HL7') /*W*/ group by 1, 2`,
  org_hours: `select o.name org, o.cls, b.hour hr, count(*) n from builds b join orgs o on o.id = b.org_id
    where b.org_id in (select b.org_id from builds b where 1=1 /*W*/ group by 1 having count(*) >= 150) /*W*/ group by o.id, b.hour`,

  // HL7 calendar
  weekly_hl7: `select date(b.ts, 'unixepoch', 'weekday 0', '-6 days') wk, sum(b.cls = 1) hl7, sum(b.cls <> 1) oth, count(*) n
    from builds b where 1=1 /*W*/ group by 1 order by 1`,
  calendar: `select kind, label, start, "end", confidence, source from calendar order by start`,

  // Contributors (commits table)
  c_kpi: `select count(*) commits, count(distinct case when p.is_bot = 0 then p.id end) humans,
      count(distinct case when p.is_bot = 1 then p.id end) bots, sum(p.is_bot = 1) bot_commits,
      sum(c.person_id is null) unlinked, count(distinct c.repo_id) repos
    from commits c left join people p on p.id = c.person_id where 1=1 /*C*/`,
  c_people: `select p.id, p.login, p.is_bot, count(*) n, count(distinct c.repo_id) repos, count(distinct r.org_id) orgs
    from commits c join people p on p.id = c.person_id join repos r on r.id = c.repo_id
    where 1=1 /*C*/ group by p.id order by n desc`,
  c_matrix: `select p.login, o.name org, count(*) n from commits c join people p on p.id = c.person_id
    join repos r on r.id = c.repo_id join orgs o on o.id = r.org_id where p.is_bot = 0 /*C*/ group by 1, 2`,
  c_coverage: `select count(*) covered, (select count(distinct b.repo_id) from builds b where 1=1 /*W*/) built,
      (select count(*) from builds b where b.repo_id in (select id from repos where gh_covered = 1) /*W*/) covered_builds,
      (select count(*) from builds b where 1=1 /*W*/) all_builds
    from repos r where r.gh_covered = 1 and r.id in (select b.repo_id from builds b where 1=1 /*W*/)`,

  // Cost & footprint (whole cluster; not filterable except by date)
  billing: `select month, cls, sum(cost) cost from billing_monthly group by 1, 2 order by 1`,
  billing_jobs: `select strftime('%Y-%m', b.ts, 'unixepoch') m, count(*) n from builds b group by 1`,
  preempt_weekly: `select date(day, 'weekday 0', '-6 days') wk, sum(n) n from preemptions_daily
    where day >= :pfrom and day <= :pto group by 1 order by 1`,
  disk_volume: `select * from disk_volume`,
  disk_orgs: `select d.org, max(o.cls) cls, sum(d.gib) gib, count(*) repos from disk_by_repo d left join orgs o on o.name = d.org
    where 1=1 {DISKW} group by d.org order by gib desc`,
  disk_repos: `select d.org, d.repo, d.gib, d.branch_dirs from disk_by_repo d left join orgs o on o.name = d.org
    where 1=1 {DISKW} order by d.gib desc limit 15`,

  // Inside a build
  err_buckets: `select case when b.errors = 0 then 0 when b.errors < 10 then 1 when b.errors < 100 then 2 else 3 end bk, count(*) n
    from builds b where b.outcome = 1 and b.errors is not null /*W*/ group by 1 order by 1`,
  fhir: `select br.fhir, count(distinct br.id) n from builds b join branches br on br.id = b.branch_id
    where br.fhir is not null /*W*/ group by 1 order by n desc`,
  mem_hist: `select cast(br.qa_mem_gib as int) gib, count(*) n from branches br
    where br.qa_mem_gib is not null and br.id in (select b.branch_id from builds b where 1=1 /*W*/) group by 1 order by 1`,

  // Multi-year proxy (global)
  pkg_years: `select cast(substr(day, 1, 4) as int) y, count(*) n, sum(version like '%ballot%') ballot, count(distinct name) pk
    from pkg_versions group by 1 order by 1`,
  pkg_year_list: `select name, version, day from pkg_versions where substr(day, 1, 4) = :y order by day desc`,

  // Focus panel
  focus_repo: `select r.name repo, o.name org, r.gh_default_branch db, r.gh_covered gc, count(b.id) n,
      sum(b.outcome = 2) bad, sum(b.outcome in (1, 2)) done, min(b.ts) t0, max(b.ts) t1, count(distinct b.branch_id) branches
    from repos r join orgs o on o.id = r.org_id left join builds b on b.repo_id = r.id where r.id = :rid`,
  focus_contrib: `select p.login, p.is_bot, count(*) n from commits c join people p on p.id = c.person_id
    where 1=1 /*C*/ group by p.id order by n desc limit 12`,

  // Detail tables (paged)
  rows_builds: `select datetime(b.ts, 'unixepoch') "start (UTC)", o.name org, r.name repo, br.name branch, x.name outcome,
      round(b.minutes, 1) minutes, b.upload_mb "MB", b.errors "QA errors"
    from builds b join orgs o on o.id = b.org_id join repos r on r.id = b.repo_id join branches br on br.id = b.branch_id
    join outcomes x on x.id = b.outcome where 1=1 /*W*/`,
  rows_repos: `select o.name org, r.name repo, c.name class, count(*) builds, count(distinct b.branch_id) branches,
      round(100.0 * sum(b.outcome = 2) / nullif(sum(b.outcome in (1, 2)), 0), 1) "fail %", round(sum(b.minutes) / 60.0, 1) "build-hours"
    from builds b join repos r on r.id = b.repo_id join orgs o on o.id = r.org_id join classes c on c.id = o.cls
    where 1=1 /*W*/ group by r.id`,
  rows_people: `select p.login, case p.is_bot when 1 then 'bot' else '' end bot, count(*) commits, count(distinct c.repo_id) repos,
      count(distinct r.org_id) orgs, date(min(c.ts), 'unixepoch') first, date(max(c.ts), 'unixepoch') last
    from commits c join people p on p.id = c.person_id join repos r on r.id = c.repo_id where 1=1 /*C*/ group by p.id`,
};
