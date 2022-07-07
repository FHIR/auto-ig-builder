## Ad-hoc web usage report

```sh
gcloud logging read  'resource.labels.container_name=nginx and resource.labels.project_id=fhir-org-starter-project' --limit 10000000 > gcloud.log
# can add time filters like: and timestamp>"2022-06-30T16:06:46.637813844Z"

cat gcloud.log | grep " - - " | sed 's/^[ \t]*//' > gcloud.nginx.log
goaccess gcloud.nginx.log -o report.html --log-format=COMBINED --ignore-panel=REFERRING_SITES --ignore-panel=HOSTS
