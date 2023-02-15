# Build and push to GCR

```sh
docker build -t gcr.io/fhir-org-starter-project/ci-build  -f Dockerfile  .
gcloud docker -- push gcr.io/fhir-org-starter-project/ci-build
```
