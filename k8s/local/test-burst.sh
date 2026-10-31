#!/bin/bash
# Rapid pushes to one branch must not pile up builds, and the last push must
# win. Makes real commits to a test repo's branch (GitHub API), sends the
# webhook for each, watches the branch's jobs, and checks the published page.
#
#   ./test-burst.sh --local        trigger on localhost:8080, cluster context igb
#   ./test-burst.sh --production   the deployed trigger and build.fhir.org
#
#   REPO=jmandel/ig-build-test  BRANCH=burst  N=5  PAGE=en/spec.html (where the marker is published)
#
# Scenario 1: push, wait until that build is running, then N quick pushes
#   (expected: one successor queued and the running build cancelled; later
#   pushes only update the successor).
# Scenario 2: N webhooks at the same moment for the same commit.
# Pass: never more than 2 jobs or running pods for the branch; none left afterwards; the
# published spec.html shows the last marker.

set -uo pipefail

REPO="${REPO:-jmandel/ig-build-test}" BRANCH="${BRANCH:-burst}" N="${N:-5}"
case "${1:-}" in
    --local)
        URL=http://localhost:8080; K="kubectl --context ${CTX:-igb} -n fhir"
        fetch() { local p; p=$($K get pod -l run=ci-build --field-selector=status.phase=Running -o name | head -1)
                  $K exec "$p" -c ci-build -- cat "/home/fhir_upload/uploading/www/ig/$REPO/branches/$BRANCH/$1" 2>/dev/null; } ;;
    --production)
        URL=https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger
        K="kubectl --context gke_fhir-org-starter-project_us-east1-d_fhir-k8s -n fhir"
        fetch() { curl -s "https://build.fhir.org/ig/$REPO/branches/$BRANCH/$1"; } ;;
    *) echo "usage: $0 --local|--production" >&2; exit 2 ;;
esac

slug=$(echo "${REPO/\//-}-$BRANCH" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-\n' '-')
jobs_now() { $K get jobs -o name 2>/dev/null | grep -c -- "$slug" || true; }
# Unfinished pods for the branch, including any orphaned by a cancelled job.
pods_now() { $K get pods --no-headers 2>/dev/null | grep -- "$slug" | grep -vcE "Completed|Error|Terminating" || true; }
hook() { curl -s -m 60 "$URL" -H 'Content-Type: application/json' \
    -d "{\"repository\":{\"full_name\":\"$REPO\"},\"ref\":\"refs/heads/$BRANCH\"}" | jq -c '{state,created,jobId,patched,canceled,reason}'; }
commit() {  # $1 = marker; appends it to input/pagecontent/spec.md on the branch
    local cur sha body
    cur=$(gh api "repos/$REPO/contents/input/pagecontent/spec.md?ref=$BRANCH")
    sha=$(echo "$cur" | jq -r .sha)
    body=$(echo "$cur" | jq -r .content | base64 -d | grep -v '^BURST-MARKER' ; echo; echo "BURST-MARKER $1")
    gh api -X PUT "repos/$REPO/contents/input/pagecontent/spec.md" -f message="burst test $1" \
        -f content="$(printf '%s\n' "$body" | base64 -w0)" -f sha="$sha" -f branch="$BRANCH" --jq .commit.sha | cut -c1-8
}

# The branch, from master, if missing.
if ! gh api "repos/$REPO/branches/$BRANCH" >/dev/null 2>&1; then
    gh api "repos/$REPO/git/refs" -f ref="refs/heads/$BRANCH" -f sha="$(gh api "repos/$REPO/branches/master" --jq .commit.sha)" >/dev/null
fi

max=0
watch_jobs() {  # background: record the most jobs seen at once
    while :; do echo "$(jobs_now)" >> "$tmp/counts"; echo "$(pods_now)" >> "$tmp/podcounts"; sleep 2; done
}
tmp=$(mktemp -d); trap 'kill $watcher 2>/dev/null; rm -rf "$tmp"' EXIT
watch_jobs & watcher=$!

run=$(date +%H%M%S)
echo "== Scenario 1: push, wait for it to run, then $N quick pushes"
echo "commit $(commit "$run-0")  webhook $(hook)"
for _ in $(seq 60); do
    $K get pods -o json | jq -e --arg s "$slug" '[.items[] | select(.metadata.name | contains($s)) | select(.status.phase=="Running")] | length > 0' >/dev/null && break
    sleep 5
done
echo "first build is running"
for i in $(seq 1 "$N"); do echo "commit $(commit "$run-$i")  webhook $(hook)"; sleep 1; done
last="$run-$N"

echo "== Scenario 2: $N simultaneous webhooks for the same commit"
pids=()
for i in $(seq 1 "$N"); do hook > "$tmp/hook.$i" & pids+=($!); done
wait "${pids[@]}"
cat "$tmp"/hook.* | sort | uniq -c

echo "== Waiting for the branch's jobs to finish"
for _ in $(seq 120); do [ "$(jobs_now)" = 0 ] && [ "$(pods_now)" = 0 ] && break; sleep 15; done
kill $watcher 2>/dev/null
max=$(sort -n "$tmp/counts" | tail -1)
maxpods=$(sort -n "$tmp/podcounts" | tail -1)
left=$(jobs_now)
leftpods=$(pods_now)
published=$(fetch "${PAGE:-en/spec.html}" | grep -o "BURST-MARKER [0-9-]*" | head -1)

fails=0
[ "${max:-0}" -le 2 ] && echo "ok    at most $max jobs at once" || { echo "FAIL  $max jobs at once"; fails=1; }
[ "${maxpods:-0}" -le 2 ] && echo "ok    at most $maxpods running pods at once" || { echo "FAIL  $maxpods running pods at once"; fails=1; }
[ "$left" = 0 ] && echo "ok    no jobs left" || { echo "FAIL  $left jobs left"; fails=1; }
[ "$leftpods" = 0 ] && echo "ok    no pods left" || { echo "FAIL  $leftpods pods left (orphans?)"; fails=1; }
[ "$published" = "BURST-MARKER $last" ] && echo "ok    published the last push ($last)" \
    || { echo "FAIL  published '${published:-nothing}', expected BURST-MARKER $last"; fails=1; }
exit $fails
