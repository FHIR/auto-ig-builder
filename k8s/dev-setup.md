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
cd auto-ig-builder/triggers/ig-commit-trigger
./setup-secret.sh
```

## Rate Limiting

The build service uses Caddy with the `caddy-ratelimit` plugin to limit requests to `qas.json` files:
- **Limit**: 100 requests per minute per IP address
- **Scope**: Only applies to external IPs; internal IPs (10.0.0.0/8) are exempt
- **Implementation**: Custom Caddy image with rate limiting configured in `k8s/Caddyfile`

This prevents abuse while allowing internal monitoring systems unlimited access.

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

7. Deploy updates to `caddy-ratelimit` image (custom Caddy with rate limiting plugin)

```
cd images/caddy-ratelimit
docker build -t gcr.io/fhir-org-starter-project/caddy-ratelimit:latest -f Dockerfile .
docker push gcr.io/fhir-org-starter-project/caddy-ratelimit:latest

# After pushing, restart the deployment to use the new image
kubectl rollout restart deployment/ci-build-deployment -n fhir
kubectl rollout status deployment/ci-build-deployment -n fhir
```

8. Apply `ci-build` web config updates

Use this when changing `k8s/Caddyfile` or the IG index UI at `k8s/ig-index/index.html`.

```
cd k8s

kubectl -n fhir create configmap caddy-conf-volume \
  --from-file=Caddyfile \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n fhir create configmap ig-index-volume \
  --from-file=ig-index/index.html \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f ci-build.deployment.yaml
kubectl rollout restart deployment/ci-build-deployment -n fhir
kubectl rollout status deployment/ci-build-deployment -n fhir
```

9. Deploy updates to IG commit trigger

```
cd triggers/ig-commit-trigger
npm test
npm run typecheck

gcloud functions deploy ig-commit-trigger \
  --region=us-central1 \
  --runtime=nodejs22 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=ig-commit-trigger \
  --memory=256MB \
  --timeout=60s \
  --source=.
```

Note: Node.js 22 is GA and recommended.

10. Configure or update the 5-minute stale-pin sweep

The same deployed `ig-commit-trigger` function also serves a periodic repair path at
`?action=sweep`. A Cloud Scheduler job should call the trigger every 5 minutes with
`apply=1`.

```
gcloud services enable cloudscheduler.googleapis.com

FUNCTION_URL="$(gcloud functions describe ig-commit-trigger \
  --region=us-central1 \
  --format='value(httpsTrigger.url)')"

gcloud scheduler jobs create http ig-commit-trigger-sweep \
  --location=us-central1 \
  --schedule='*/5 * * * *' \
  --time-zone='Etc/UTC' \
  --http-method=POST \
  --uri="${FUNCTION_URL}?action=sweep&apply=1"
```

If the Scheduler job already exists, update it instead:

```
gcloud scheduler jobs update http ig-commit-trigger-sweep \
  --location=us-central1 \
  --schedule='*/5 * * * *' \
  --time-zone='Etc/UTC' \
  --http-method=POST \
  --uri="${FUNCTION_URL}?action=sweep&apply=1"
```

Useful checks:

```
gcloud scheduler jobs describe ig-commit-trigger-sweep --location=us-central1
gcloud scheduler jobs run ig-commit-trigger-sweep --location=us-central1
curl "${FUNCTION_URL}?action=sweep"
```


---

## Testing locally with minikube

```sh
minikube config set memory 20000
minikube start
eval $(minikube -p minikube docker-env)

kubectl  create ns fhir

ssh-keygen -t rsa -f id
kubectl  -n fhir create secret generic ci-build-keys --from-file=id --from-file=id.pub

echo "" > keyfile.ini
echo "{}" > fhir-settings.json
kubectl  -n fhir create secret generic fhir-settings --from-file=keyfile.ini --from-file=fhir-settings.json

kubectl  -n fhir create secret generic zulip-secrets --from-literal=email=bot@hsot --from-literal=api_key=zapi
```

Build the igbuild image as `igbuild` in minikube docker

    kubectl apply -f example-job-for-minikube.yaml
