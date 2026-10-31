# ig-commit-trigger

Google Cloud Function that receives GitHub push webhooks and schedules
FHIR IG builds as Kubernetes Jobs.

See [SOLUTION.md](../../investigations/2026-03-27-ig-trigger-concurrency/SOLUTION.md)
for the design rationale, including the branch state machine, same-node
successor pinning, and flood-collapse behavior.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (JSDoc + @ts-check, no build step)
npm test            # node test-scheduling.js
npm start           # run locally via functions-framework (needs a kubeconfig, see below)
```

### Local testing

Prefer the local copy of the whole stack in `k8s/local` (minikube), which runs
this trigger against a local cluster: see `k8s/local/README.md`.

To run against the real cluster instead, point `KUBECONFIG_PATH` at the
production credential without writing it into this directory (anything here
can end up in an upload). Webhooks sent via curl will create real jobs:

```bash
KUBECONFIG_PATH=<(gcloud secrets versions access latest --secret ig-trigger-kubeconfig) npm start
```

```bash
curl -X POST http://localhost:8080 \
  -H 'Content-Type: application/json' \
  -d '{"repository":{"full_name":"org/repo"},"ref":"refs/heads/main","after":"abc"}'
```

The same process can also exercise the prototype sweep path through the same trigger:

```bash
curl 'http://localhost:8080?action=sweep'
curl -X POST 'http://localhost:8080?action=sweep&apply=1&jobName=igbuild-...'
```

## Deploy

The function is 1st gen (`--no-gen2` is required). Its Kubernetes credential is
the Secret Manager secret `ig-trigger-kubeconfig`, mounted as a file; it is not
part of the uploaded source. `.gcloudignore` excludes any `*.kubeconfig`
anyway.

```bash
cd triggers/ig-commit-trigger

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

Use the version of `ig-trigger-kubeconfig` currently deployed
(`gcloud functions describe ig-commit-trigger --region us-central1 --format='value(secretVolumes)'`),
or a new one from `./setup-secret.sh`.

### Credential and permissions

- The function acts as the Kubernetes service account `fhir/igbuild`, with only
  the permissions in `k8s/ig-trigger.rbac.yaml`: jobs, pods and events in
  `fhir`, and listing nodes. Don't widen it. Anything that can create Jobs can
  create pods, so this credential must stay out of anything a pod can read.
- To rotate the credential, run `./setup-secret.sh`. It mints a new token, stores
  it as a new secret version and prints the deploy flag. Then redeploy, test, and
  delete the old token secret it lists. That revokes the old token everywhere.
- Only the function's runtime account
  (`fhir-org-starter-project@appspot.gserviceaccount.com`) may read the secret.

Operationally, the intended model is a single deployed trigger. A Cloud Scheduler
job can call the same function URL with `?action=sweep` on a short interval, so the
webhook path and the stale-pin repair path stay in one deployment unit.

### Cloud Scheduler sweep

This project currently uses the same deployed trigger for both:

- normal GitHub webhooks
- periodic stale-pin recovery via `action=sweep`

The scheduled sweep should run every 5 minutes and call the deployed function with
global apply enabled:

```bash
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

To inspect the configured job:

```bash
gcloud scheduler jobs describe ig-commit-trigger-sweep \
  --location=us-central1
```

To update the schedule or target URI later:

```bash
gcloud scheduler jobs update http ig-commit-trigger-sweep \
  --location=us-central1 \
  --schedule='*/5 * * * *' \
  --time-zone='Etc/UTC' \
  --http-method=POST \
  --uri="${FUNCTION_URL}?action=sweep&apply=1"
```

To force a manual run:

```bash
gcloud scheduler jobs run ig-commit-trigger-sweep \
  --location=us-central1
```

Notes:

- This first cut uses the function's existing unauthenticated HTTP endpoint.
- The sweep endpoint is intentionally global for cron; targeted `jobName=...` is for
  manual/operator testing only.
- `apply=1` means the scheduler will actually repair stale pinned successors, not just
  report them.

## Files

- `index.js` — GCF HTTP handler (webhook parsing, ig.ini check, HEAD resolution, sweep routing)
- `scheduling.js` — branch state machine, job construction, reconciliation loop
- `sweep.js` — prototype stale-pin sweep logic for `action=sweep`
- `job.json` — K8s Job template
- `test-scheduling.js` — unit tests with mock K8s clients
- `test-sweep.js` — stale-pin classifier tests
- `setup-secret.sh` — mints the trigger's Kubernetes credential into Secret Manager
