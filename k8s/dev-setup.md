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

8. Deploy updates to IG commit trigger

```
cd triggers/ig-commit-trigger
gcloud functions deploy ig-commit-trigger --runtime nodejs22 --trigger-http
```

Note: Node.js 22 is GA and recommended.


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

