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

## Deploy

```bash
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

## Files

- `index.js` — GCF HTTP handler (webhook parsing, ig.ini check, HEAD resolution)
- `scheduling.js` — branch state machine, job construction, reconciliation loop
- `job.json` — K8s Job template
- `test-scheduling.js` — unit tests with mock K8s clients
- `sa.kubeconfig` — service account credentials for K8s access (not in git)
