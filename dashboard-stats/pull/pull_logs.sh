#!/bin/bash
# Cloud Logging pulls (read-only), month by month, into $IGSTATS_WORK:
#   audit/jobs_YYYY-MM.ndjson      GKE audit: build Job create/delete by the igbuild service account (~400 d retention)
#   container/upload_YYYY-MM.ndjson ig-upload lifecycle lines: builder start, publish attempt (status, counts), upload size (~366 d)
#   preemptions.ndjson             Compute Engine spot preemption events
# Months already on disk are skipped, except the last month of the window (re-pulled, it is partial).
set -euo pipefail
. "$(dirname "$0")/../env.sh"
cd "$IGSTATS_WORK"; mkdir -p audit container
LR="python3 $DS_HOME/pull/logread.py"
last=$(date -u -d "$WINDOW_END -1 month" +%Y-%m-01)
month_loop() { # $1 kind  $2 first month
  local d=$2
  while [[ "$d" < "$WINDOW_END" ]]; do
    local n; n=$(date -u -d "$d +1 month" +%Y-%m-%d)
    local out=$1/$( [ "$1" = audit ] && echo jobs || echo upload )_${d:0:7}.ndjson
    if [[ ! -s $out || "$d" == "$last" ]]; then
      echo "$1: $d..$n" >&2
      if [ "$1" = audit ]; then
        $LR "resource.type=\"k8s_cluster\" AND protoPayload.authenticationInfo.principalEmail=\"system:serviceaccount:fhir:igbuild\" AND protoPayload.methodName:\"io.k8s.batch.v1.jobs.\" AND timestamp>=\"${d}T00:00:00Z\" AND timestamp<\"${n}T00:00:00Z\"" 'timestamp,protoPayload' \
        | jq -c '{ts: .timestamp, method: (.protoPayload.methodName|split(".")|last), job: (.protoPayload.resourceName|split("/")|last), code: .protoPayload.status.code,
            env: ([.protoPayload.request.spec.template.spec.containers[]?.env[]? | select(.value!=null and (.name|test("^(IG_|JAVA_MEMORY|PUBLISHER_JAR_URL)"))) | {(.name): .value}] | add),
            mem_req: (.protoPayload.request.spec.template.spec.containers[0]?.resources.requests.memory)}' > $out.tmp
      else
        $LR "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"fhir\" AND resource.labels.container_name=\"ig-upload\" AND (textPayload:\"Waiting for the builder\" OR textPayload:\"Starting publish attempt 1/\" OR textPayload:\"to CI build from\" OR textPayload=~\"^[0-9.]+[KMG]\\t\\.\$\") AND timestamp>=\"${d}T00:00:00Z\" AND timestamp<\"${n}T00:00:00Z\"" \
        | jq -c '{ts:.timestamp, job:.labels."k8s-pod/job-name", pod:.resource.labels.pod_name, t:.textPayload}' > $out.tmp
      fi
      mv $out.tmp $out
    fi
    d=$n
  done
}
month_loop audit "$WINDOW_START"
month_loop container "$(date -u -d "$WINDOW_START +1 month" +%Y-%m-01)"
echo "preemptions" >&2
$LR "resource.type=\"gce_instance\" AND protoPayload.methodName=\"compute.instances.preempted\" AND timestamp>=\"${WINDOW_START}T00:00:00Z\"" 'timestamp' > preemptions.ndjson.tmp
mv preemptions.ndjson.tmp preemptions.ndjson
