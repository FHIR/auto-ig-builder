gcloud compute disks create fhir-ci-build-disk --size 100GB

kubectl  -n fhir create secret generic zulip-secrets --from-literal=email=$ZULIP_EMAIL --from-literal=api_key=$ZULIP_API_KEY

gcloud compute disks create caddy-cert-disk --size=10GB --zone=us-east1-d
kubectl  -n fhir create configmap caddy-conf-volume --from-file Caddyfile

kubectl apply -f ci-build.configmap.yaml
kubectl apply -f ci-build.deployment.yaml
kubectl apply -f ci-build.service.yaml

kubectl create serviceaccount igbuild --namespace fhir

# Now create a secret for it (needed for k8s > 1.23)
https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#manually-create-a-long-lived-api-token-for-a-serviceaccount
