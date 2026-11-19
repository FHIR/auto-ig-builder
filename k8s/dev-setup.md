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
  E2 does not pin a CPU generation, which matters for CPU-specific bugs (for
  example Java4Shell needs AVX-512 VBMI). To see what the nodes are on:
  `gcloud compute instances list --filter="name~gke-fhir-k8s" --format="value(name,cpuPlatform)"`.
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

## Pruning builds of deleted branches and repos

`images/ci-build/prune-stale` runs in the ci-build container (supervisord) and
keeps published builds from outliving their source. Every 3 hours it lists
each published repo's branches and tags with `git ls-remote` (about 720 repos,
two at a time, a minute or two per scan) and compares them with
`www/ig/<org>/<repo>/branches/*`:

- A published branch with no GitHub branch or tag of that name (tag pushes are
  published like branches) is removed once it has been missing on two scans at
  least `PRUNE_GRACE_HOURS` (24) apart. `main`/`master` in the official orgs
  (`PRUNE_KEEP`) are never removed this way. If `__default` pointed at it, it is
  re-pointed to GitHub's current default branch when that has a build.
- A repo GitHub reports as "Repository not found" (deleted, or no longer
  public) is removed whole, with the same two-scan rule.
- Any other failure (timeout, empty listing) skips that repo for the scan.
- The whole scan is ignored (no removals, no state changes) if a canary repo
  (`PRUNE_CANARIES`: `HL7/fhir`, `FHIR/auto-ig-builder`) doesn't list
  normally, or if more than 10% of repos come back "not found"
  (`PRUNE_MAX_NOT_FOUND_SHARE`). `branch-status.json` then says why.

`PRUNE_MODE` in `k8s/ci-build.deployment.yaml` is `report` (record only) or
`delete`. Each scan writes https://build.fhir.org/ig/branch-status.json: what is
pending with first-missing times, what is due (in report mode, what delete mode
would remove), what was kept and what couldn't be checked, plus recent
removals. State lives in `~/uploading/prune-state.json` on the site disk. Logs:
`kubectl -n fhir logs deploy/ci-build-deployment -c ci-build | grep prune-stale`.
Tests: `python3 -I images/ci-build/test_prune_stale.py`.

The age-based cleanup in `reindex` (90 days without a new build, official
`main`/`master` exempt) still runs as well.

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

Production is the `ci` target of `images/ig-publisher/Dockerfile`, run on amd64
nodes. See `images/ig-publisher/README.md` for where each image is published.
Settings that only change
how the job runs, such as env vars or JVM flags, belong in
`triggers/ig-commit-trigger/job.json` and ship with a trigger deploy instead,
with no rebuild.

Toolchain versions are pinned in the Dockerfile; `images/ig-publisher/update-pins.sh`
moves them to the latest upstream releases. The "Update Toolchain Pins" GitHub
workflow runs it daily and keeps one PR (`auto/update-pins`) open with any
changes and the image test results; merge it by hand. Before shipping any
image change, compare the candidate with the current image on real IGs with
`images/ig-publisher/ab-test.sh` (CI runs the same comparison natively on amd64
and arm64 for every change under `images/ig-publisher/`).

Every merge to master that touches `images/ig-publisher/` makes GitHub build
both images natively for amd64 and arm64 and publish them to GHCR as
`ghcr.io/fhir/ig-build:candidate-<12-char sha>` (and the localdev image as
`ghcr.io/fhir/ig-publisher-localdev:candidate-<sha>`). GitHub holds no
credentials for the production registry: getting an image there is always a
step on an operator's machine. Source it either from that GitHub candidate
or from a local build, push it under a dated tag, test that tag in isolation
(see "Isolated test against production" in
`triggers/ig-commit-trigger/README.md`), then retag it as `latest`. Jobs use
`imagePullPolicy: Always`, so the next build picks it up, and the older tags
stay as a rollback.

```
gcloud auth configure-docker gcr.io
TAG=gcr.io/fhir-org-starter-project/ig-build:<what>-$(date +%Y%m%d)

# Either: copy GitHub's candidate (all architectures, same digest in both registries)
docker buildx imagetools create -t $TAG ghcr.io/fhir/ig-build:candidate-<sha>

# Or: build it here (on Apple Silicon this amd64 build is emulated and slow)
cd images/ig-publisher
docker build --pull --platform linux/amd64 --target ci -t $TAG .
docker push $TAG

# after the isolated test passes:
gcloud container images add-tag $TAG gcr.io/fhir-org-starter-project/ig-build:latest
```

5b. Release the localdev image

GitHub publishes `ghcr.io/fhir/ig-publisher-localdev:candidate-<sha>` and
`hl7fhir/ig-publisher-base:candidate-<sha>` on every merge that touches
`images/ig-publisher/`. Once a candidate has passed its tests, run the
"Promote Tested Docker Candidate" workflow with that tag:

```
gh workflow run promote-localdev.yaml -f candidate_tag=candidate-<sha>
```

IG authors pull `latest`, so mention toolchain changes (Ruby, Java or Node
versions, base OS) in the committers/announce channel when promoting.

6. Deploy updates to `ci-build` image

```
cd images/ci-build
python3 -I test_prune_stale.py
docker build -t gcr.io/fhir-org-starter-project/ci-build  -f Dockerfile .
docker push gcr.io/fhir-org-starter-project/ci-build   # after gcloud auth configure-docker gcr.io
kubectl -n fhir apply -f ../../k8s/ci-build.deployment.yaml   # if the manifest changed
kubectl -n fhir rollout restart deployment/ci-build-deployment
```

Restarting ci-build takes build.fhir.org down briefly (one replica, and the
site disk can only be attached to one node at a time). Pick a quiet moment and
check `kubectl -n fhir get jobs` for uploads in flight.

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
