docker tag static  gcr.io/fhir-org-starter-project/ci-build
gcloud docker -- push gcr.io/fhir-org-starter-project/ci-build

gcloud compute disks create fhir-ci-build-disk --size 20GB
gcloud compute disks create fhir-svn-sync-disk --size 20GB

# kubectl run --namespace fhir  ci-build  --image=gcr.io/fhir-org-starter-project/ci-build

kubectl  --namespace fhir create secret generic deploy.build.fhir.org \
  --from-file deploy.build.fhir.org \
  --from-file deploy.build.fhir.org.pub

kubectl apply -f ci-build.deployment 
kubectl apply -f svn-sync.deployment 
