# Local copy of the build.fhir.org stack

A minikube cluster running the production manifests and images, for testing
changes to the trigger, the build and upload containers, ci-build and Caddy
before they reach production. It builds real IGs from GitHub and publishes
them to a local ci-build pod.

## What differs from production

| Production | Local |
|---|---|
| GKE, COS nodes (kernel 6.12) | minikube QEMU VM (kernel 6.6), containerd |
| GCE persistent disks | PVCs on the VM's disk |
| Let's Encrypt certificates | Caddy's internal CA (`local_certs`) |
| LoadBalancer with a static IP | ClusterIP; reach it from inside the cluster |
| Cloud Function (1st gen) | `functions-framework` on localhost:8080 |
| Real secrets | Placeholders, and a fresh SSH key pair in the state directory |
| Build memory 22–30 GiB | 4–10 GiB (`JAVA_MEMORY` 6000m) |

GitHub webhook and App delivery can't be tested locally; post the webhook
JSON to localhost instead.

## Setup

The Docker driver does not work on a host whose running kernel lacks
`xt_comment` (for example after a kernel upgrade without a reboot), so use the
QEMU driver. On Arch the firmware lives in `/usr/share/edk2`:

```bash
minikube start -p igb --driver=qemu2 --qemu-firmware-path=/usr/share/edk2/x64/OVMF_CODE.4m.fd \
  --network=builtin --container-runtime=containerd --kubernetes-version=v1.35.0 \
  --cpus=8 --memory=18g --disk-size=40g --keep-context
```

`--keep-context` leaves your default kubectl context alone. Everything here
uses `--context igb` explicitly, and `up.sh` refuses a GKE context.

Load the production images by digest (gcr.io needs the gcloud credential
helper; a stale saved token in `~/.docker/config.json` breaks pulls, so point
`DOCKER_CONFIG` at a config that has only `{"credHelpers":{"gcr.io":"gcloud"}}`):

```bash
R=gcr.io/fhir-org-starter-project
for x in ig-build@sha256:… ci-build@sha256:… caddy-ratelimit@sha256:…; do
  docker pull $R/$x && docker tag $R/$x local/${x%@*}:prod && minikube -p igb image load local/${x%@*}:prod
done
minikube -p igb image load ubuntu:16.04
```

Then:

```bash
# Production's live Caddyfile, if it differs from the repo's
kubectl --context gke_fhir-org-starter-project_us-east1-d_fhir-k8s -n fhir \
  get configmap caddy-conf-volume -o jsonpath='{.data.Caddyfile}' > ~/.cache/auto-ig-builder-local/Caddyfile.prod

CADDYFILE=~/.cache/auto-ig-builder-local/Caddyfile.prod ./up.sh
./trigger.sh &          # serves the trigger on localhost:8080
curl localhost:8080 -H 'Content-Type: application/json' \
  -d '{"repository":{"full_name":"FHIR/sample-ig"},"ref":"refs/heads/master"}'
./check-hosting.sh --local
```

## Scripts

- `up.sh`: namespace, placeholder secrets, config maps, PVCs, the ci-build
  Deployment and Service (from `../ci-build.deployment.yaml` and
  `../ci-build.service.yaml`), and the trigger's service account. Rerun it after
  changing any of those. `CI_BUILD_IMAGE` and `CADDY_IMAGE` pick images.
  Restart the Deployment to pick up a Caddyfile change (it is a subPath mount).
- `trigger.sh`: runs the trigger from a copy in the state directory, so the
  repo never holds a local `sa.kubeconfig` that a production deploy could
  upload. `SRC` picks the trigger source (e.g. a git worktree of another
  commit), `IG_BUILD_IMAGE` the build image, and `JOB_PATCH` a jq filter applied
  to `job.json`.
- `check-hosting.sh`: read-only hosting checks. `--local` runs them inside the
  local ci-build pod; without it, against production.

State (keys, kubeconfig, rendered manifests, trigger copy) lives in
`~/.cache/auto-ig-builder-local`.

## Notes

- Build jobs delete themselves 30 s after finishing (`ttlSecondsAfterFinished`),
  taking their logs with them. The publisher log is also copied into the
  published output as `build.log`.
- With a JOB_PATCH, compare a build's `qa.json` counts (errs, warnings, hints)
  with production's for the same commit and publisher version.
