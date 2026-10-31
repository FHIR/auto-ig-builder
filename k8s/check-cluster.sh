#!/bin/bash
# Read-only check that the cluster still has the security settings described in
# dev-setup.md ("Cluster security setup"). Prints ok/FAIL per item; exits 1 on any FAIL.

set -uo pipefail
PROJECT=fhir-org-starter-project ZONE=us-east1-d CLUSTER=fhir-k8s
CTX="${CTX:-gke_${PROJECT}_${ZONE}_${CLUSTER}}"
k() { kubectl --context "$CTX" "$@"; }
fails=0
check() {  # name, actual, expected
    if [ "$2" == "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got '$2', want '$3'"; fails=$((fails + 1)); fi
}

c=$(gcloud container clusters describe $CLUSTER --zone $ZONE --project $PROJECT --format=json)
check "Workload Identity pool" "$(jq -r '.workloadIdentityConfig.workloadPool' <<<"$c")" "$PROJECT.svc.id.goog"
check "Shielded Nodes" "$(jq -r '.shieldedNodes.enabled // false' <<<"$c")" "true"
check "kubelet read-only port off (pool default)" \
    "$(jq -r '.nodePoolDefaults.nodeConfigDefaults.nodeKubeletConfig.insecureKubeletReadonlyPortEnabled // false' <<<"$c")" "false"

for pool in $(jq -r '.nodePools[].name' <<<"$c"); do
    p=$(jq --arg p "$pool" '.nodePools[] | select(.name == $p)' <<<"$c")
    check "$pool: metadata server hidden (GKE_METADATA)" "$(jq -r '.config.workloadMetadataConfig.mode' <<<"$p")" "GKE_METADATA"
    check "$pool: Secure Boot" "$(jq -r '.config.shieldedInstanceConfig.enableSecureBoot // false' <<<"$p")" "true"
    check "$pool: kubelet read-only port off" \
        "$(jq -r '.config.kubeletConfig.insecureKubeletReadonlyPortEnabled // "unset"' <<<"$p")" "false"
done

check "fhir namespace enforces baseline Pod Security" \
    "$(k get ns fhir -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}')" "baseline"
SA=system:serviceaccount:fhir:igbuild
check "igbuild can create jobs in fhir" "$(k auth can-i create jobs -n fhir --as=$SA)" "yes"
check "igbuild cannot read secrets" "$(k auth can-i get secrets -n fhir --as=$SA)" "no"
check "igbuild cannot create pods directly" "$(k auth can-i create pods -n fhir --as=$SA)" "no"
check "igbuild has no cluster-wide rights" "$(k auth can-i '*' '*' --all-namespaces --as=$SA)" "no"
check "no legacy long-lived igbuild tokens besides the current one" \
    "$(k -n fhir get secrets -o json | jq '[.items[] | select(.type == "kubernetes.io/service-account-token")] | length')" "1"
check "ci-build pinned to build-fhir-org" \
    "$(k -n fhir get deploy ci-build-deployment -o jsonpath='{.spec.template.spec.nodeSelector.cloud\.google\.com/gke-nodepool}')" "build-fhir-org"
check "ci-build pod running on build-fhir-org" \
    "$(k get node "$(k -n fhir get pod -l run=ci-build --field-selector=status.phase=Running -o jsonpath='{.items[0].spec.nodeName}')" \
        -o jsonpath='{.metadata.labels.cloud\.google\.com/gke-nodepool}')" "build-fhir-org"
check "upload key restricted to ssh-dispatch" \
    "$(k -n fhir exec "$(k -n fhir get pod -l run=ci-build --field-selector=status.phase=Running -o name | head -1)" -c ci-build -- \
        cut -d' ' -f1 /home/fhir_upload/.ssh/authorized_keys)" 'restrict,command="/usr/local/bin/ssh-dispatch"'
check "trigger kubeconfig not in the uploaded function source" \
    "$(gcloud functions describe ig-commit-trigger --region us-central1 --project $PROJECT --format='value(environmentVariables.KUBECONFIG_PATH)')" "/etc/ig-trigger/kubeconfig"

echo "$fails failure(s)"
exit $((fails > 0))
