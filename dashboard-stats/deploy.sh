#!/bin/bash
# Publish site/ (including site/data/igstats.sqlite) to https://build.fhir.org/ig/_dashboard/ (public).
# GitHub org names can't contain "_", so /ig/_dashboard can't collide with an IG.
# Streams a tarball into the running ci-build pod as fhir_upload, unpacks it into a staging directory
# on the upload disk, then swaps it into www/ig/_dashboard.
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$DS_HOME/site"
[ -s data/igstats.sqlite ] || { echo "site/data/igstats.sqlite missing; run ./rebuild.sh first" >&2; exit 1; }
pod=$(kubectl --context "$KUBE_CONTEXT" -n fhir get pod -l run=ci-build --field-selector=status.phase=Running -o name | head -1)
stage="dashboard-stage-$(date +%s)"

tar czf - . | kubectl --context "$KUBE_CONTEXT" -n fhir exec -i "$pod" -c ci-build -- \
    su -s /bin/sh fhir_upload -c "set -e
        cd ~/uploading && mkdir $stage && tar xzf - -C $stage
        [ -d www/ig/_dashboard ] && mv www/ig/_dashboard $stage.old || true
        mv $stage www/ig/_dashboard
        rm -rf $stage.old"

curl -fsS -o /dev/null -w "published: %{http_code}\n" https://build.fhir.org/ig/_dashboard/
