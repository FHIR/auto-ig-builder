#!/bin/bash
# Read-only checks of build.fhir.org's static hosting. Against production:
#   ./check-hosting.sh
# Against the local copy (run inside the cluster, since that's where the
# Service is reachable):
#   ./check-hosting.sh --local
#
#   ORG/REPO/BRANCH  an IG that has built successfully (default FHIR/sample-ig/master)
#   PAGE             a resource page in it, for content negotiation
#   ODD_BRANCH       a branch with + , or non-ASCII characters to fetch, if any

set -uo pipefail

ORG="${ORG:-FHIR}" REPO="${REPO:-sample-ig}" BRANCH="${BRANCH:-master}"
PAGE="${PAGE:-ActorDefinition-example}"   # a resource page in that IG, without .html
ODD_BRANCH="${ODD_BRANCH:-}"

if [ "${1:-}" == "--local" ]; then
    K="kubectl --context ${CTX:-igb} -n fhir"
    pod=$($K get pod -l run=ci-build --field-selector=status.phase=Running -o name | head -1)
    ip=$($K get svc ci-build-service -o jsonpath='{.spec.clusterIP}')
    $K exec -i "$pod" -c ci-build -- env ORG="$ORG" REPO="$REPO" BRANCH="$BRANCH" PAGE="$PAGE" ODD_BRANCH="$ODD_BRANCH" \
        CURL_EXTRA="-k --resolve build.fhir.org:443:$ip --resolve build.fhir.org:80:$ip" bash -s < "$0"
    exit $?
fi

fails=0
check() {  # name, expected status, curl args...
    local name="$1" want="$2"; shift 2
    local got
    got=$(curl -s -o /dev/null -w '%{http_code}' -m 20 ${CURL_EXTRA:-} "$@")
    if [ "$got" == "$want" ]; then echo "ok    $name ($got)"; else echo "FAIL  $name: got $got, want $want"; fails=$((fails + 1)); fi
}
body() { curl -s -m 20 ${CURL_EXTRA:-} "$@"; }

B=https://build.fhir.org
IG="$B/ig/$ORG/$REPO"
check "core build home"            200 "$B/"
check "IG index"                   200 "$B/ig/"
check "qas.json"                   200 "$B/ig/qas.json"
check "builds.json"                200 "$B/ig/builds.json"
check "branch page"                200 "$IG/branches/$BRANCH/"
check "default branch (__default)" 200 "$IG/"
check "build.log"                  200 "$IG/branches/$BRANCH/build.log"
check "qa.json"                    200 "$IG/branches/$BRANCH/qa.json"
check "plain http"                 200 "http://build.fhir.org/ig/"
check "missing page"               404 "$IG/branches/$BRANCH/no-such-page-$$"
[ -n "$ODD_BRANCH" ] && check "odd branch name" 200 "$IG/branches/$(jq -rn --arg b "$ODD_BRANCH" '$b|@uri')/"

if body "$B/ig/qas.json" | jq -e 'type == "array" and length > 0' >/dev/null; then
    echo "ok    qas.json is a non-empty array"
else
    echo "FAIL  qas.json is not a non-empty JSON array"; fails=$((fails + 1))
fi
cors=$(curl -s -o /dev/null -D - -m 20 ${CURL_EXTRA:-} "$B/ig/qas.json" | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d' ' -f2)
if [ "$cors" == "*" ]; then echo "ok    CORS header"; else echo "FAIL  CORS header: '$cors'"; fails=$((fails + 1)); fi

# Content negotiation: a resource page asked for as FHIR JSON.
if body -H 'Accept: application/fhir+json' "$IG/branches/$BRANCH/$PAGE" | jq -e '.resourceType' >/dev/null 2>&1; then
    echo "ok    content negotiation ($PAGE as fhir+json)"
else
    echo "FAIL  content negotiation ($PAGE as fhir+json)"; fails=$((fails + 1))
fi

# Recorded, not judged: production answers OPTIONS with 405 until the
# Caddyfile change in 26b8de5 is applied.
echo "info  OPTIONS qas.json: $(curl -s -o /dev/null -w '%{http_code}' -m 20 -X OPTIONS ${CURL_EXTRA:-} "$B/ig/qas.json")"

echo "$fails failure(s)"
exit $((fails > 0))
