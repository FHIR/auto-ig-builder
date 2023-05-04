# New Dev Setup

Current deployment process requires access to `fhir-org-startr-project` in the HL7 GCP org.

1. Install `kubectl`
2. Install `gcloud`
3. Configure access to cluster

```
gcloud container clusters get-credentials fhir-k8s --zone us-east1-d
```

4. Set up `auto-ig-builder` repo

```
git clone https://github.com/FHIR/auto-ig-builder/
cd triggers/ig-commit-trigger
export SECRET=$(kubectl get serviceaccount igbuild --namespace fhir --output jsonpath={.secrets[0].name})
export CLUSTER_IP=$(gcloud container clusters --zone us-east1-d describe fhir-k8s --format='value(endpoint)')

# Manually edit secret.json to add
 * `clusterIp`
 * `zulip_email`
 * `zulip_api_key`

```

## Recurring tasks
5. Deploy updates to the `ig-build` image

```
cd images/ig-build
docker build -t gcr.io/fhir-org-starter-project/ig-build  -f Dockerfile .
gcloud docker -- push gcr.io/fhir-org-starter-project/ig-build
```

6. Deploy updates to `ci-build` image

```
cd images/ci-build
docker build -t gcr.io/fhir-org-starter-project/ci-build  -f Dockerfile .
gcloud docker -- push gcr.io/fhir-org-starter-project/ci-build
```

7. Deploy updates to IG commit trigger

```
cd triggers/ig-commit-trigger
gcloud functions deploy ig-commit-trigger --runtime nodejs8 --trigger-http
```
