docker tag static  gcr.io/fhir-org-starter-project/ci-build
gcloud docker -- push gcr.io/fhir-org-starter-project/ci-build

gcloud compute disks create fhir-ci-build-disk --size 20GB

# kubectl run --namespace fhir  ci-build  --image=gcr.io/fhir-org-starter-project/ci-build


kubectl  --namespace fhir create secret generic ci-build-keys  --from-file=id=~/Private/deploy.build.fhir.org --from-file=id.pub=~/Private/deploy.build.fhir.org.pub --from-file=ig.builder.keyfile.ini=~/Private/ig.builder.keyfile.ini
kubectl  --namespace fhir create secret generic gforge-secrets --from-literal=email=$ZULIP_EMAIL --from-literal=api_key=$ZULIP_API_KEY --from-literal=gforge_password=$GFORGE_PASSWORD
kubectl  --namespace fhir create secret generic fhir-org-ssl-keys  --from-file=tls.key=~/Private/certs/fhir.org.key.pem --from-file=tls.chained.crt=~/Private/certs/fhir.org.chained.pem

kubectl apply -f ci-build.configmap.yaml
kubectl apply -f ci-build.deployment.yaml
kubectl apply -f gforge-to-zulip.deployment.yaml

kubectl apply -f lego

kubectl  -n fhir create configmap caddy-conf-volume --from-file Caddyfile
