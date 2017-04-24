docker tag static  gcr.io/fhir-org-starter-project/ci-build
gcloud docker -- push gcr.io/fhir-org-starter-project/ci-build

gcloud compute disks create fhir-ci-build-disk --size 20GB

kubectl run --namespace fhir  ci-build  --image=gcr.io/fhir-org-starter-project/ci-build
