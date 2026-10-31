#!/bin/bash
# Disk usage of the build.fhir.org upload volume, read-only, at idle I/O and CPU priority.
# Do NOT run while ci-build is restarting or being redeployed: it execs into the running ci-build pod.
# Output: $IGSTATS_WORK/disk/du-kib.tsv (KiB<TAB>path, down to branch folders) and df.txt.
set -euo pipefail
. "$(dirname "$0")/../env.sh"
mkdir -p "$IGSTATS_WORK/disk"
pod=$(kubectl --context "$KUBE_CONTEXT" -n fhir get pod -l run=ci-build --field-selector=status.phase=Running -o jsonpath='{range .items[?(@.metadata.deletionTimestamp)]}{.metadata.name}{end}')
[ -n "$pod" ] && { echo "a ci-build pod is terminating ($pod); not scanning during a restart" >&2; exit 1; }
pod=$(kubectl --context "$KUBE_CONTEXT" -n fhir get pod -l run=ci-build --field-selector=status.phase=Running -o name | head -1)
[ -z "$pod" ] && { echo "no running ci-build pod" >&2; exit 1; }
ready=$(kubectl --context "$KUBE_CONTEXT" -n fhir get "$pod" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
[ "$ready" = "True" ] || { echo "$pod is not Ready; try later" >&2; exit 1; }
echo "scanning via $pod (this takes a while)" >&2
kubectl --context "$KUBE_CONTEXT" -n fhir exec "$pod" -c ci-build -- su -s /bin/sh fhir_upload -c \
  'cd ~/uploading && df -k . && ionice -c3 nice -n19 du -k -d 6 . 2>/dev/null' \
| awk -v df="$IGSTATS_WORK/disk/df.txt.tmp" -v du="$IGSTATS_WORK/disk/du-kib.tsv.tmp" '
    NR <= 2 { print > df; next }
    { split($0, a, "\t"); n = split(a[2], p, "/");
      # keep: everything to depth 4 (./www/ig/org/repo), and www/ig/<org>/<repo>/branches/<branch>
      if (n <= 5 || (p[2] == "www" && p[3] == "ig" && p[6] == "branches" && n == 7)) print > du }'
mv "$IGSTATS_WORK/disk/df.txt.tmp" "$IGSTATS_WORK/disk/df.txt"
mv "$IGSTATS_WORK/disk/du-kib.tsv.tmp" "$IGSTATS_WORK/disk/du-kib.tsv"
date -u +%Y-%m-%d > "$IGSTATS_WORK/disk/scan_date"
wc -l "$IGSTATS_WORK/disk/du-kib.tsv" >&2
