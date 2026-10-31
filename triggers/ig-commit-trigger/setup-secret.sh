#!/bin/bash
# Mint a token for the trigger's service account (fhir/igbuild) and store a
# kubeconfig holding it as a new version of the Secret Manager secret
# ig-trigger-kubeconfig. The deployed function mounts that secret; the
# kubeconfig must never be written into this directory, because the function's
# uploaded source is readable by every GKE node.
#
# Then redeploy with the printed version (see README "Deploy"), and once the
# new deploy works, delete the previous token secret it lists.
#
# First-time setup also needs k8s/ig-trigger.rbac.yaml applied, the Secret
# Manager API enabled, and the secret created:
#   gcloud secrets create ig-trigger-kubeconfig --replication-policy=automatic --data-file=/dev/null
#   gcloud secrets add-iam-policy-binding ig-trigger-kubeconfig \
#     --member=serviceAccount:fhir-org-starter-project@appspot.gserviceaccount.com \
#     --role=roles/secretmanager.secretAccessor

set -euo pipefail

PROJECT="${PROJECT:-fhir-org-starter-project}"
CONTEXT="${CONTEXT:-gke_fhir-org-starter-project_us-east1-d_fhir-k8s}"
SECRET=ig-trigger-kubeconfig
k() { kubectl --context "$CONTEXT" -n fhir "$@"; }

name="igbuild-token-$(date +%Y%m%d-%H%M%S)"
k apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: $name
  annotations: {kubernetes.io/service-account.name: igbuild}
type: kubernetes.io/service-account-token
EOF

token=""
for _ in $(seq 30); do
    token=$(k get secret "$name" -o jsonpath='{.data.token}' | base64 -d)
    [ -n "$token" ] && break
    sleep 1
done
[ -n "$token" ] || { echo "Token for $name was not issued" >&2; exit 1; }

server="https://$(gcloud container clusters describe fhir-k8s --zone us-east1-d --project "$PROJECT" --format='value(endpoint)')"
ca=$(k get secret "$name" -o jsonpath='{.data.ca\.crt}')

umask 077
tmp=$(mktemp)
trap 'shred -u "$tmp" 2>/dev/null || rm -f "$tmp"' EXIT
cat > "$tmp" <<EOF
apiVersion: v1
kind: Config
clusters:
- name: fhir-k8s
  cluster: {certificate-authority-data: $ca, server: $server}
contexts:
- name: ig-trigger
  context: {cluster: fhir-k8s, namespace: fhir, user: igbuild}
current-context: ig-trigger
users:
- name: igbuild
  user: {token: $token}
EOF

[ "$(KUBECONFIG="$tmp" kubectl auth can-i create jobs -n fhir)" == yes ] || { echo "New token cannot create jobs" >&2; exit 1; }

version=$(gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file="$tmp" --format='value(name)' | awk -F/ '{print $NF}')
echo "Stored as $SECRET version $version."
echo "Redeploy with --set-secrets=/etc/ig-trigger/kubeconfig=$SECRET:$version"
echo "Then delete the older token secrets:"
k get secrets -o json | jq -r --arg keep "$name" \
    '.items[] | select(.type=="kubernetes.io/service-account-token" and .metadata.name!=$keep) | "  kubectl -n fhir delete secret \(.metadata.name)"'
