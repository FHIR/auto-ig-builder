# Shared settings for dashboard-stats scripts. Source it: . "$(dirname "$0")/env.sh"
# Override any of these in the environment or in a git-ignored dashboard-stats/config.env.
DS_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$DS_HOME/config.env" ] && . "$DS_HOME/config.env"
export DS_HOME
export IGSTATS_WORK="${IGSTATS_WORK:-$DS_HOME/work}"               # raw pulls, DuckDB, caches (git-ignored)
export GCP_PROJECT="${GCP_PROJECT:-fhir-org-starter-project}"
export KUBE_CONTEXT="${KUBE_CONTEXT:-gke_fhir-org-starter-project_us-east1-d_fhir-k8s}"
export WINDOW_START="${WINDOW_START:-2025-09-01}"                  # first month to pull (logs keep ~400 days)
export WINDOW_END="${WINDOW_END:-$(date -u -d "$(date -u +%Y-%m-01) +1 month" +%Y-%m-%d)}"  # exclusive
# BILLING_EXPORT_TABLE: full BigQuery id of the *resource-level* billing export, e.g.
#   <project>.<dataset>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>
# It embeds the billing-account id, so it is never committed: set it in config.env.
export BILLING_EXPORT_TABLE="${BILLING_EXPORT_TABLE:-}"
mkdir -p "$IGSTATS_WORK"
