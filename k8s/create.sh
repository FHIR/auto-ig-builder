gcloud compute disks create fhir-ci-build-disk --size 100GB

kubectl  -n fhir create secret generic zulip-secrets --from-literal=email=$ZULIP_EMAIL --from-literal=api_key=$ZULIP_API_KEY
kubectl  -n fhir create configmap caddy-conf-volume --from-file Caddyfile

kubectl apply -f ci-build.configmap.yaml
kubectl apply -f ci-build.deployment.yaml
kubectl apply -f ci-build.service.yaml

kubectl create serviceaccount igbuild --namespace fhir
