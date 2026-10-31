-- Raw pulls -> igstats.duckdb. Run from $IGSTATS_WORK (paths are relative to it).
create or replace macro org_class(o) as case
  when o = 'HL7' then 'HL7 International'
  when lower(o) like 'hl7%' or o in ('HL7NZ','IHE') then case when o = 'IHE' then 'IHE' else 'HL7 affiliate' end
  when o in ('FHIR','cqframework') then 'FHIR/HL7 community'
  else 'other (gov, vendor, individual)' end;

-- Build job creates/deletes (GKE audit log)
create or replace table audit_jobs as
select ts::timestamp ts, method, job, code, env.IG_ORG org, env.IG_REPO repo, env.IG_BRANCH branch,
  env.JAVA_MEMORY java_mem, mem_req
from read_json_auto('audit/jobs_*.ndjson', union_by_name=true, maximum_object_size=10000000);
create or replace view creates as select *, org_class(org) cls from audit_jobs where method = 'create' and coalesce(code, 0) = 0;

-- Per-pod outcomes from ig-upload lines. Two publish-line formats: legacy "Publish <org> <repo> <branch> <status> ... to CI build from"
-- (until ~Apr 2026) and "Starting publish attempt 1/N for <org> <repo> <branch> <status> ... errors = N" (from ~Apr 2026).
create or replace table upload_lines as select ts::timestamp as ts, job, pod, t from read_json_auto('container/upload_*.ndjson', union_by_name=true);
create or replace table builds as
with s as (select pod, any_value(job) as job,
   min(ts) filter (where t like 'Waiting for the builder%') as started,
   min(ts) filter (where t like 'Starting publish attempt 1/%' or t like 'Publish % to CI build from%') as finished,
   arg_min(t, ts) filter (where t like 'Starting publish attempt 1/%' or t like 'Publish % to CI build from%') as pub,
   arg_min(t, ts) filter (where regexp_matches(t, '^[0-9.]+[KMG](\t|\\t)\.$')) as du
 from upload_lines group by pod)
select pod, job, started, finished, date_diff('second', started, finished) / 60.0 as minutes,
  regexp_extract(pub, '(?:for|^Publish) (\S+) (\S+) (\S+) (\S+) ', ['org','repo','branch','status']) as f,
  try_cast(regexp_extract(pub, 'errors = (\d+)', 1) as int) as errors,
  case regexp_extract(du, '^[0-9.]+([KMG])', 1) when 'K' then 1 / 1024.0 when 'M' then 1 when 'G' then 1024 end
    * try_cast(regexp_extract(du, '^([0-9.]+)', 1) as double) as upload_mb
from s;

create or replace table qas as select *, split_part(repo, '/', 1) org, split_part(repo, '/', 2) repo_name, split_part(repo, '/', 4) branch,
  (dateISO8601 at time zone 'UTC')::timestamp dt from read_json_auto('qas.json', union_by_name=true);
create or replace table preemptions as select timestamp::timestamp as ts from read_json_auto('preemptions.ndjson');
create or replace table pkg_versions as select name, version, time::timestamp as t from read_json_auto('pkg/pkg_versions.ndjson');
-- HL7 calendar: see hl7_calendar.sql (read by rebuild.sh after this file)
