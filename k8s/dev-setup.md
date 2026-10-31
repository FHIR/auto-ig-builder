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
```

The trigger's Kubernetes credential lives in Secret Manager, not in the
checkout; see "Cluster security setup" below.

## Cluster security setup

Anyone on GitHub can make the cluster build their content, so every build pod
runs untrusted code. The setup assumes that:

- **The trigger's credential.** The Cloud Function acts as `fhir/igbuild` with only
  the permissions in `k8s/ig-trigger.rbac.yaml` (`kubectl apply -f k8s/ig-trigger.rbac.yaml`).
  Never bind `igbuild` to `admin` or `cluster-admin`: anything that can create
  Jobs can create pods. Its kubeconfig is the Secret Manager secret
  `ig-trigger-kubeconfig`, readable only by the function's runtime account and
  mounted into the function at deploy time. Create or rotate it with
  `triggers/ig-commit-trigger/setup-secret.sh`. Never put a kubeconfig in the
  function's source directory: uploaded sources sit in a bucket that GKE nodes
  can read.
- **Workload Identity on every node pool** (`--workload-metadata=GKE_METADATA`,
  cluster `--workload-pool=fhir-org-starter-project.svc.id.goog`). Without it,
  any pod can fetch the node's Google token from the metadata server. The nodes
  run as the project's shared default compute account, which can read every
  bucket in the project. Nothing in `fhir` needs Google credentials. New node
  pools must be created with `--workload-metadata=GKE_METADATA`. To check:
  `gcloud container node-pools describe POOL --cluster fhir-k8s --zone us-east1-d --format='value(config.workloadMetadataConfig.mode)'`.
- **Nodes:** Shielded GKE Nodes (cluster `--enable-shielded-nodes`) with
  integrity monitoring on every pool. Secure Boot is deliberately off: it can only
  be set when a pool is created, and recreating the pools wasn't judged worth it
  (2026-10-31). The kubelet's unauthenticated
  read-only port (10255) off, both as the cluster default
  (`--no-enable-insecure-kubelet-readonly-port`) and on each pool. Before
  this, any pod could list every pod on its node from that port. Changing any
  of these recreates the nodes. New pools must be created with all of them,
  plus `--workload-metadata=GKE_METADATA`.
- **Node pools:** `ig-build-pool` (spot e2-highmem-4, autoscaled, build jobs),
  `ig-buid-on-demand-failover` (on-demand, when spot is unavailable) and
  `build-fhir-org` (one on-demand e2-standard-2). The ci-build Deployment is
  pinned to `build-fhir-org` with a `nodeSelector`; otherwise the scheduler can
  put the web server on a spot node, which is preempted many times a day.
- **Check it all:** `k8s/check-cluster.sh` (read-only) verifies the settings in
  this section and exits non-zero on any drift.
- **Build jobs** (`triggers/ig-commit-trigger/job.json`) run as uid 1000 with the
  RuntimeDefault seccomp profile, `allowPrivilegeEscalation: false` and all
  capabilities dropped, and get no Kubernetes API token
  (`automountServiceAccountToken: false`). Their pods are marked
  `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`, so a scale-down
  doesn't kill a running build (a rebuild starts over and uses the job's only
  retry).
- **The upload ssh key** (shared by the IG upload sidecar and the core FHIR
  build's Azure pipeline) may run only `/usr/local/bin/ssh-dispatch`, set by
  `restrict,command=` in `authorized_keys`. The dispatcher runs `publish` or
  `publish-ig` without a shell, and both scripts refuse names outside letters,
  digits and `. _ + , -`.
- **Pod Security Admission** on the `fhir` namespace: `enforce=baseline`
  (no privileged, host-path, host-network or host-PID pods, even for someone
  holding the trigger's job-creating credential), `warn=restricted`
  (informational; ci-build and the capacity placeholders run as root, so they
  warn). Set in `k8s/create.sh`.
- **The ci-build pod** (`k8s/ci-build.deployment.yaml`) runs sshd and supervisord as
  root, so it keeps root's capabilities, but it has RuntimeDefault seccomp and
  `allowPrivilegeEscalation: false`.
- **Names reaching shells.** Org, repo and branch names are limited to letters,
  digits and `. _ + , -` by the trigger, quoted by the upload sidecar, and checked
  again by `publish-ig` on ci-build.

Background and verification: `investigations/2026-10-31-webhook-name-injection/`
and `investigations/2026-10-31-cluster-admin-token-exposure/`.

## Rate Limiting

The build service uses Caddy with the `caddy-ratelimit` plugin to limit requests to `qas.json` files:
- **Limit**: 100 requests per minute per IP address
- **Scope**: Only applies to external IPs; internal IPs (10.0.0.0/8) are exempt
- **Implementation**: Custom Caddy image with rate limiting configured in `k8s/Caddyfile`

This prevents abuse while allowing internal monitoring systems unlimited access.

## Access logs

Caddy writes one JSON line per request to stdout (~15 GiB/day). A Cloud Logging
exclusion on the `_Default` sink, `caddy-access-keep-1pct` (added 2026-10-31),
drops 99% of those `handled request` lines before ingestion; Caddy's errors and
all other logs are kept. This cut logging cost from ~$140–190/month to a few
dollars. To see or remove it: `gcloud logging sinks describe _Default` /
`gcloud logging sinks update _Default --remove-exclusions=caddy-access-keep-1pct`.
Absolute request counts from the logs must be multiplied by 100 after the cutover;
shares are unaffected (`dashboard-stats/pull/caddy_sample.py` accounts for it).

## Growing the site disk

`fhir-ci-build-disk` holds everything build.fhir.org serves; check it with
`kubectl -n fhir exec <ci-build pod> -c ci-build -- df -h /home/fhir_upload/uploading`.
It can be grown online, with no restart:

```bash
gcloud compute disks resize fhir-ci-build-disk --zone us-east1-d --size <GB>
NODE=$(kubectl -n fhir get pod -l run=ci-build -o jsonpath='{.items[0].spec.nodeName}')
# The disk is mounted directly (not through a PVC), so grow the filesystem from the node:
kubectl debug node/$NODE -n default --profile=sysadmin --image=busybox:1.37.0 -- chroot /host resize2fs /dev/disk/by-id/google-fhir-ci-build-disk
kubectl -n default get pods -o name | grep node-debugger | xargs kubectl -n default delete   # remove the debug pod
```

The by-id name finds the disk whatever device letter it got on that node. The filesystem's root reserve is 1% (`tune2fs -m 1 /dev/disk/by-id/google-fhir-ci-build-disk`), not the
default 5%: nothing writing to this disk runs as root, so a 5% reserve would only
hide space.

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
  --no-gen2 \
  --region=us-central1 \
  --runtime=nodejs22 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=ig-commit-trigger \
  --memory=256MB \
  --timeout=60s \
  --set-secrets=/etc/ig-trigger/kubeconfig=ig-trigger-kubeconfig:VERSION \
  --set-env-vars=KUBECONFIG_PATH=/etc/ig-trigger/kubeconfig \
  --source=.
```

`VERSION` is the Secret Manager version of the trigger's credential; see
`triggers/ig-commit-trigger/README.md`. `job.json` is bundled with the function,
so build-pod changes also ship this way.

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


11. Refresh the build statistics dashboard

The public dashboard at https://build.fhir.org/ig/_dashboard/ is a static page that queries a SQLite file in the browser. `dashboard-stats/` holds the whole pipeline: `./rebuild.sh all` pulls Cloud Logging, BigQuery billing (dry-run guarded), GitHub commits, a sampled access-log mix and a read-only disk scan into the git-ignored `dashboard-stats/work/`, then builds `site/data/igstats.sqlite`; `./deploy.sh` publishes it and `node test/smoke_test.mjs` checks the live page. Put the billing export table name (it embeds the billing-account id) in the git-ignored `dashboard-stats/config.env`, and don't run the disk scan during a ci-build restart. Details in `dashboard-stats/README.md`.

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
