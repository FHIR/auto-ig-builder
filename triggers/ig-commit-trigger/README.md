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
npm start           # run locally via functions-framework (uses sa.kubeconfig → real cluster)
```

### Local testing against the cluster

`npm start` runs the function on `http://localhost:8080`. It uses `sa.kubeconfig`
to talk to the real K8s cluster, so webhooks sent via curl will create real jobs:

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

```bash
cd triggers/ig-commit-trigger

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
- `sa.kubeconfig` — service account credentials for K8s access (not in git)
