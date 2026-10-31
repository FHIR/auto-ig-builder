#!/bin/bash
# Public, unauthenticated sources: build.fhir.org qas.json and packages2.fhir.org version dates for hl7.fhir.* packages.
set -euo pipefail
. "$(dirname "$0")/../env.sh"
cd "$IGSTATS_WORK"; mkdir -p pkg
curl -fsSL --retry 5 -o qas.json.tmp https://build.fhir.org/ig/qas.json && mv qas.json.tmp qas.json
for i in 1 2 3 4 5; do
  curl -fsSL "https://packages2.fhir.org/packages/-/v1/search?text=hl7.fhir" -o pkg/search_hl7.json.tmp && jq -e '.objects|length > 0' pkg/search_hl7.json.tmp >/dev/null && break
  sleep 10
done
mv pkg/search_hl7.json.tmp pkg/search_hl7.json
: > pkg/pkg_versions.ndjson.tmp
for p in $(jq -r '.objects[].package.name' pkg/search_hl7.json | grep '^hl7\.fhir\.' | sort -u); do
  curl -fsSL --retry 3 "https://packages2.fhir.org/packages/$p" | jq -c --arg p "$p" '(.time // {}) | to_entries[] | select(.key!="created" and .key!="modified") | {name:$p, version:.key, time:.value}' >> pkg/pkg_versions.ndjson.tmp || echo "skip $p" >&2
  sleep 0.25
done
mv pkg/pkg_versions.ndjson.tmp pkg/pkg_versions.ndjson
wc -l pkg/pkg_versions.ndjson >&2
