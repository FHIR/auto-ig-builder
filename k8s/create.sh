# Published site (1500 GB since 2026-10-31; see dev-setup.md "Growing the site disk")
gcloud compute disks create fhir-ci-build-disk --size 1500GB

kubectl  -n fhir create secret generic zulip-secrets --from-literal=email=$ZULIP_EMAIL --from-literal=api_key=$ZULIP_API_KEY

ssh-keygen -t rsa -f id
kubectl  -n fhir create secret generic ci-build-keys --from-file=id --from-file=id.pub

# get these from Grahame ;-)
kubectl  -n fhir create secret generic fhir-settings --from-file=keyfile.ini --from-file=fhir-settings.json

gcloud compute disks create caddy-cert-disk --size=10GB --zone=us-east1-d
kubectl -n fhir create configmap caddy-conf-volume --from-file Caddyfile --dry-run=client -o yaml | kubectl apply -f -
kubectl -n fhir create configmap ig-index-volume --from-file=ig-index/index.html --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f ci-build.configmap.yaml
kubectl apply -f ci-build.deployment.yaml
kubectl apply -f ci-build.service.yaml

# Refuse privileged, host-path and host-network pods in fhir (see dev-setup.md "Cluster security setup")
kubectl label --overwrite ns fhir pod-security.kubernetes.io/enforce=baseline pod-security.kubernetes.io/enforce-version=latest pod-security.kubernetes.io/warn=restricted

kubectl create serviceaccount igbuild --namespace fhir
# The trigger's permissions; nothing broader (see dev-setup.md "Cluster security setup")
kubectl apply -f ig-trigger.rbac.yaml
# Then store its credential in Secret Manager: ../triggers/ig-commit-trigger/setup-secret.sh
