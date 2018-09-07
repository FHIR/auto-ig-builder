docker tag static  gcr.io/fhir-org-starter-project/ci-build
gcloud docker -- push gcr.io/fhir-org-starter-project/ci-build

gcloud compute disks create fhir-ci-build-disk --size 20GB
gcloud compute disks create fhir-svn-sync-disk --size 20GB

# kubectl run --namespace fhir  ci-build  --image=gcr.io/fhir-org-starter-project/ci-build

kubectl  --namespace fhir create secret generic github-fhir-svn  \
  --from-file ~/Private/deploy_fhir_svn \
  --from-file ~/Private/deploy_fhir_svn.pub


kubectl  --namespace fhir create secret generic ci-build-keys  --from-file=id=/home/jmandel/Private/deploy.build.fhir.org --from-file=id.pub=/home/jmandel/Private/deploy.build.fhir.org.pub
kubectl  --namespace fhir create secret generic gforge-secrets --from-literal=email=$ZULIP_EMAIL --from-literal=api_key=$ZULIP_API_KEY --from-literal=gforge_password=$GFORGE_PASSWORD
 kubectl  --namespace fhir create secret generic fhir-org-ssl-keys --from-file=tls.crt=/home/jmandel/Private/certs/fhir.org.cert.pem  --from-file=ca.crt=/home/jmandel/Private/certs/fhir.org.intermediate.cert.pem  --from-file=tls.key=/home/jmandel/Private/certs/fhir.org.key.pem --from-file=tls.chained.crt=/home/jmandel/Private/certs/fhir.org.chained.pem

kubectl apply -f ci-build.configmap.yaml
kubectl apply -f hapi.deployment.yaml  -f hapi.service.yaml
kubectl apply -f ci-build.deployment.yaml
kubectl apply -f gforge-to-zulip.deployment.yaml

# no longer needed -- transitioned to github
# kubectl apply -f svn-sync.deployment.yaml

kubectl apply -f lego
