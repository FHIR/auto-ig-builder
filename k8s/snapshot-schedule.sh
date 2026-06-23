#!/bin/bash
# Automated, cost-bounded backups for the ci-build persistent disk.
#
# fhir-ci-build-disk holds the published build.fhir.org/ig site (/var/www) and the
# SSH upload landing zone — but had no recovery point, so a disk loss or an
# accidental VM/disk delete was unrecoverable. This attaches a *snapshot schedule*
# with a retention window: we always keep recent restore points WITHOUT snapshots
# piling up.
#
# Why this stays cheap:
#   - snapshots are INCREMENTAL — each stores only blocks changed since the previous
#     one, stored COMPRESSED; you are billed on those compressed/used bytes, not the
#     disk's provisioned (1TB) or used size.
#   - the schedule AUTO-DELETES snapshots older than RETENTION_DAYS, so the set is
#     bounded. Steady-state cost ~= (compressed baseline) + RETENTION_DAYS*(daily
#     delta) — NOT N full copies.
#   - snapshots are stored in a single region (cheaper than multi-region).
#
# Idempotent: safe to re-run (already-exists / already-attached are tolerated).
#
# Tip: run this AFTER cleaning orphaned staging dirs out of ~/uploading (see
# images/ci-build reindex GC), so the baseline snapshot isn't bloated with cruft.
set -euo pipefail

PROJECT=${PROJECT:-fhir-org-starter-project}
REGION=${REGION:-us-east1}            # must match the disk's region
ZONE=${ZONE:-us-east1-d}              # the fhir-k8s cluster zone
RETENTION_DAYS=${RETENTION_DAYS:-7}   # cost dial: 3 = cheaper, 14 = more history
START_TIME=${START_TIME:-08:00}       # UTC, low-traffic window
POLICY=${POLICY:-ci-build-daily-${RETENTION_DAYS}d}
# Disks to protect. Add caddy-cert-disk if you also want its TLS state backed up.
DISKS=${DISKS:-"fhir-ci-build-disk"}

echo "Creating snapshot schedule '$POLICY' (daily, keep ${RETENTION_DAYS}d, region $REGION)..."
gcloud compute resource-policies create snapshot-schedule "$POLICY" \
  --project="$PROJECT" --region="$REGION" \
  --daily-schedule --start-time="$START_TIME" \
  --max-retention-days="$RETENTION_DAYS" \
  --storage-location="$REGION" \
  --on-source-disk-delete=keep-auto-snapshots \
  --snapshot-labels=purpose=ci-build-backup \
  || echo "  (policy '$POLICY' already exists — continuing)"

for d in $DISKS; do
  echo "Attaching '$POLICY' to disk '$d'..."
  gcloud compute disks add-resource-policies "$d" \
    --project="$PROJECT" --zone="$ZONE" --resource-policies="$POLICY" \
    || echo "  ('$d' already has the policy, or disk not found — continuing)"
done

echo
echo "Current snapshots for: $DISKS"
filter=$(echo "$DISKS" | tr ' ' '|')
gcloud compute snapshots list --project="$PROJECT" \
  --filter="sourceDisk~\"$filter\"" \
  --format="table(name, sourceDisk.basename(), diskSizeGb, storageBytes, creationTimestamp, storageLocations.list())" \
  --sort-by=creationTimestamp

echo
echo "Done. First snapshot's storageBytes = compressed baseline; the next day's = daily delta."
echo "Note: hapi-fhir-org-v3 (project fhir-org-hapi, us-east1) has no snapshot policy"
echo "either — create an equivalent schedule in that project to protect it too."
