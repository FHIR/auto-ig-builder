#!/bin/bash
# Stand up a local copy of the build.fhir.org stack in minikube, from the same
# manifests and (by default) the same images as production. See README.md.
#
# Only differences from production: PVCs instead of GCE disks, Caddy uses its
# internal CA (no ACME), the Service has no static IP, and the secrets are
# placeholders with a fresh SSH key pair.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
K8S="$HERE/.."
CTX="${CTX:-igb}"
STATE="${STATE:-$HOME/.cache/auto-ig-builder-local}"
CI_BUILD_IMAGE="${CI_BUILD_IMAGE:-local/ci-build:prod}"
CADDY_IMAGE="${CADDY_IMAGE:-local/caddy-ratelimit:prod}"

if [[ "$CTX" == gke_* ]]; then
    echo "Refusing to run against a GKE context: $CTX" >&2
    exit 1
fi
k() { kubectl --context "$CTX" "$@"; }

mkdir -p "$STATE"
[ -f "$STATE/id" ] || ssh-keygen -q -t ed25519 -N "" -C ci-build-local -f "$STATE/id"

k create namespace fhir --dry-run=client -o yaml | k apply -f -
k label --overwrite ns fhir pod-security.kubernetes.io/enforce=baseline \
    pod-security.kubernetes.io/enforce-version=latest pod-security.kubernetes.io/warn=restricted >/dev/null

# Secrets: same names and keys as production, placeholder values.
k -n fhir create secret generic ci-build-keys --from-file=id="$STATE/id" --from-file=id.pub="$STATE/id.pub" \
    --dry-run=client -o yaml | k apply -f -
k -n fhir create secret generic fhir-settings \
    --from-literal=fhir-settings.json='{"servers":[{"type":"fhir","url":"https://terminologystandardsservice.ca/tx/fhir","authenticationType":"apikey","apikey":"placeholder"}]}' \
    --dry-run=client -o yaml | k apply -f -
k -n fhir create secret generic zulip-secrets --from-literal=email=bot@localhost --from-literal=api_key=placeholder \
    --dry-run=client -o yaml | k apply -f -

k -n fhir create configmap ci-build-config --from-literal=ssh_authorized_key="$(cat "$STATE/id.pub")" \
    --dry-run=client -o yaml | k apply -f -
# Caddy's internal CA instead of Let's Encrypt; otherwise the production Caddyfile.
sed 's/^{$/{\n\tlocal_certs/' "${CADDYFILE:-$K8S/Caddyfile}" > "$STATE/Caddyfile"
k -n fhir create configmap caddy-conf-volume --from-file=Caddyfile="$STATE/Caddyfile" \
    --dry-run=client -o yaml | k apply -f -
k -n fhir create configmap ig-index-volume --from-file="$K8S/ig-index/index.html" \
    --dry-run=client -o yaml | k apply -f -

for pvc in fhir-ci-build-disk caddy-cert-disk; do
    k apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: $pvc, namespace: fhir}
spec:
  accessModes: [ReadWriteOnce]
  resources: {requests: {storage: 5Gi}}
EOF
done

# The production Deployment and Service, adapted.
python3 - "$K8S/ci-build.deployment.yaml" "$K8S/ci-build.service.yaml" "$CI_BUILD_IMAGE" "$CADDY_IMAGE" > "$STATE/ci-build.yaml" <<'EOF'
import sys, yaml
dep_path, svc_path, ci_image, caddy_image = sys.argv[1:]
dep = yaml.safe_load(open(dep_path))
spec = dep["spec"]["template"]["spec"]
for c in spec["containers"] + spec.get("initContainers", []):
    if c["name"] == "ci-build":
        c["image"] = ci_image
    elif c["name"] == "caddy":
        c["image"] = caddy_image
    c["imagePullPolicy"] = "IfNotPresent"
spec.pop("nodeSelector", None)   # GKE node pools don't exist locally
for v in spec["volumes"]:
    if "gcePersistentDisk" in v:
        v["persistentVolumeClaim"] = {"claimName": v.pop("gcePersistentDisk")["pdName"]}
svc = yaml.safe_load(open(svc_path))
svc["spec"].pop("loadBalancerIP", None)
svc["spec"]["type"] = "ClusterIP"
yaml.safe_dump_all([dep, svc], sys.stdout, sort_keys=False)
EOF
k apply -f "$STATE/ci-build.yaml"

# The trigger's service account, with exactly production's permissions.
k -n fhir create serviceaccount igbuild --dry-run=client -o yaml | k apply -f -
k apply -f "$K8S/ig-trigger.rbac.yaml"
k -n fhir delete rolebinding ig-build-rolebinding --ignore-not-found
k apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: igbuild-token
  namespace: fhir
  annotations: {kubernetes.io/service-account.name: igbuild}
type: kubernetes.io/service-account-token
EOF
for _ in $(seq 30); do
    token=$(k -n fhir get secret igbuild-token -o jsonpath='{.data.token}' 2>/dev/null | base64 -d)
    [ -n "$token" ] && break
    sleep 1
done
server=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$CTX\")].cluster.server}")
ca=$(k -n fhir get secret igbuild-token -o jsonpath='{.data.ca\.crt}')
cat > "$STATE/sa.kubeconfig" <<EOF
apiVersion: v1
kind: Config
clusters:
- name: local
  cluster: {certificate-authority-data: $ca, server: $server}
contexts:
- name: local
  context: {cluster: local, namespace: fhir, user: igbuild}
current-context: local
users:
- name: igbuild
  user: {token: $token}
EOF
chmod 600 "$STATE/sa.kubeconfig"

k -n fhir rollout status deployment/ci-build-deployment --timeout=180s
echo "Local stack is up (context $CTX, state in $STATE)."
