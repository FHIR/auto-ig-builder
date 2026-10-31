#!/bin/bash
# Run the IG trigger locally against the minikube copy from up.sh, on
# http://localhost:${PORT:-8080}. Works on a copy of the trigger in the state
# directory, so the repo checkout never holds a local sa.kubeconfig that a
# production deploy could pick up.
#
#   SRC=path/to/ig-commit-trigger   trigger source (default: this checkout's)
#   IG_BUILD_IMAGE=local/ig-build:x image for build jobs (default: local/ig-build:prod)
#   JOB_PATCH=file.jq               extra jq filter applied to job.json

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${STATE:-$HOME/.cache/auto-ig-builder-local}"
SRC="${SRC:-$HERE/../../triggers/ig-commit-trigger}"
RUN="$STATE/trigger"

[ -f "$STATE/sa.kubeconfig" ] || { echo "Run up.sh first" >&2; exit 1; }

mkdir -p "$RUN"
rsync -a --delete --exclude node_modules --exclude sa.kubeconfig "$SRC/" "$RUN/"
# Older trigger sources (before KUBECONFIG_PATH) read ./sa.kubeconfig.
grep -q KUBECONFIG_PATH "$RUN/index.js" || cp "$STATE/sa.kubeconfig" "$RUN/sa.kubeconfig"

# Local images, and memory that fits a laptop VM.
jq '(.spec.template.spec.containers[] | .imagePullPolicy) = "IfNotPresent"
    | (.spec.template.spec.containers[] | select(.name == "ig-build")) |=
        (.resources = {requests: {memory: "4Gi"}, limits: {memory: "10Gi"}}
         | (.env[] | select(.name == "JAVA_MEMORY") | .value) = "6000m")' \
    "$RUN/job.json" > "$RUN/job.json.new"
if [ -n "${JOB_PATCH:-}" ]; then
    jq -f "$JOB_PATCH" "$RUN/job.json.new" > "$RUN/job.json.patched"
    mv "$RUN/job.json.patched" "$RUN/job.json.new"
fi
mv "$RUN/job.json.new" "$RUN/job.json"

cd "$RUN"
[ -d node_modules ] && [ package-lock.json -ot node_modules ] || npm ci --silent
KUBECONFIG_PATH="$STATE/sa.kubeconfig" \
IG_BUILD_IMAGE="${IG_BUILD_IMAGE:-local/ig-build:prod}" PORT="${PORT:-8080}" \
    exec npx functions-framework --target=ig-commit-trigger --signature-type=http
