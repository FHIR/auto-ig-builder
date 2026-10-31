-- Browser database for the IG build retrospective. Times are unix seconds, UTC.
create table meta (key text primary key, value text);
create table classes (id integer primary key, name text);          -- org class
create table outcomes (id integer primary key, name text);         -- success / failure / no result / no logs
create table kinds (id integer primary key, name text);            -- branch kind
create table orgs (id integer primary key, name text, cls integer, region text);
create table repos (id integer primary key, org_id integer, name text, gh_default_branch text, gh_covered integer default 0);
create table branches (id integer primary key, repo_id integer, name text, kind integer,
  fhir text, qa_errs integer, qa_warnings integer, qa_mem_gib real, qa_date text);   -- qa_* = qas.json snapshot
-- One row per distinct build request (jobs for the same branch within 5 s merged: the -a/-b siblings).
create table builds (id integer primary key, ts integer, org_id integer, repo_id integer, branch_id integer,
  kind integer, cls integer, outcome integer, minutes real, upload_mb real, errors integer,
  dow integer, hour integer, dow_et integer, hour_et integer);       -- dow: 1=Mon..7=Sun
create table people (id integer primary key, login text, is_bot integer);  -- public GitHub logins only
create table commits (repo_id integer, person_id integer, ts integer);       -- person_id null = no linked login
create table calendar (kind text, label text, start text, "end" text, confidence text, source text);
create table skus (id integer primary key, name text);
create table billing_daily (day text, pool text, service text, sku_id integer, cls text, cost real);   -- USD before credits, cluster-labelled rows
create table preemptions_daily (day text, n integer);
create table pkg_versions (name text, version text, day text);
create table disk_by_repo (scan text, org text, repo text, gib real, branch_dirs integer, repo_id integer);
create table disk_volume (asof text, size_gib integer, used_gib integer, free_gib integer, used_pct integer, source text);
-- Sampled web-server traffic, aggregates only (no IPs / user agents). bytes = response bytes in the sample.
create table egress_sample (days text, org text, repo text, branch text, ftype text, client text, bot text, status text,   -- ok (2xx/3xx) or error
  n integer, bytes integer, sample_min integer, repo_id integer);

-- Cost attribution (estimates), computed live from the tables above.
create view compute_rate as
  with c as (select substr(day, 1, 7) month, sum(cost) cost from billing_daily where pool like 'ig-bu%' and day >= '2026-03-01' group by 1),
       m as (select strftime('%Y-%m', ts, 'unixepoch') month, sum(minutes) mins from builds where minutes is not null group by 1)
  select c.month, c.cost, m.mins, c.cost / m.mins usd_per_min from c join m using (month);
create view egress_month as select substr(day, 1, 7) month, sum(cost) egress from billing_daily
  where pool = 'build-fhir-org' and cls = 'egress/net' and day >= '2026-03-01' group by 1;
create view disk_month as select substr(day, 1, 7) month, sum(cost) disk from billing_daily
  where pool = 'build-fhir-org' and cls = 'disk' and day >= '2026-03-01' group by 1;
create view repo_disk_share as select repo_id, sum(gib) / (select sum(gib) from disk_by_repo) share
  from disk_by_repo where repo_id is not null group by repo_id;
create view repo_egress_share as select repo_id, sum(bytes) * 1.0 / (select sum(bytes) from egress_sample) share
  from egress_sample where repo_id is not null group by repo_id;
create view egress_branch_share as select repo_id, branch, sum(bytes) * 1.0 / (select sum(bytes) from egress_sample) share
  from egress_sample where repo_id is not null group by repo_id, branch;
create view repo_month_cost as
  select m.month, s.repo_id, coalesce(d.disk, 0) * coalesce(ds.share, 0) disk, m.egress * coalesce(es.share, 0) egress
  from egress_month m left join disk_month d using (month)
  cross join (select repo_id from repo_disk_share union select repo_id from repo_egress_share) s
  left join repo_disk_share ds on ds.repo_id = s.repo_id left join repo_egress_share es on es.repo_id = s.repo_id;
