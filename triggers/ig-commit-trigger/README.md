# ig-commit-trigger

Google Cloud Function that receives GitHub and GitLab push webhooks and schedules
FHIR IG builds as Kubernetes Jobs.

See [SOLUTION.md](../../investigations/2026-03-27-ig-trigger-concurrency/SOLUTION.md)
for the design rationale, including the branch state machine, same-node
successor pinning, and flood-collapse behavior.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit (JSDoc + @ts-check, no build step)
npm test            # node test-scheduling.js && node test-sweep.js && node test-gitlab.js
npm start           # run locally via functions-framework (uses sa.kubeconfig → real cluster)
```

### Local testing against the cluster

`npm start` runs the function on `http://localhost:8080`. It uses `sa.kubeconfig`
to talk to the real K8s cluster, so webhooks sent via curl will create real jobs:

```bash
# GitHub-style payload
curl -X POST http://localhost:8080 \
  -H 'Content-Type: application/json' \
  -d '{"repository":{"full_name":"org/repo"},"ref":"refs/heads/main","after":"abc"}'

# GitLab-style payload
curl -X POST http://localhost:8080 \
  -H 'Content-Type: application/json' \
  -H 'X-Gitlab-Event: Push Hook' \
  -d '{
    "object_kind": "push",
    "ref": "refs/heads/main",
    "project": {
      "path_with_namespace": "org/my-ig",
      "git_http_url": "https://gitlab.com/org/my-ig.git"
    }
  }'
```

The same process can also exercise the prototype sweep path through the same trigger:

```bash
curl 'http://localhost:8080?action=sweep'
curl -X POST 'http://localhost:8080?action=sweep&apply=1&jobName=igbuild-...'
```

### Platform detection

The trigger detects the source platform using HTTP headers:

| Header | Platform |
|--------|----------|
| `X-Gitlab-Event: Push Hook` | GitLab |
| `X-GitHub-Event: push` (or no header) | GitHub |

GitLab payloads use `project.path_with_namespace` for the repo identity and
`project.git_http_url` for the clone URL. Nested groups (e.g. `org/sub/project`)
are supported — the last path segment is the project name, everything before is
the namespace.

### Environment variables injected into build jobs

| Variable | Description | Example (GitLab) | Example (GitHub) |
|----------|-------------|-------------------|------------------|
| `IG_ORG` | Org/namespace (platform-prefixed for GitLab) | `gitlab.com/csiro` | `HL7` |
| `IG_REPO` | Project/repository name | `my-ig` | `US-Core` |
| `IG_BRANCH` | Branch name | `main` | `master` |
| `IG_CLONE_URL` | Full HTTPS clone URL | `https://gitlab.com/csiro/my-ig.git` | `https://github.com/HL7/US-Core` |
| `IG_PLATFORM_URL` | Base URL of the forge | `https://gitlab.com` | `https://github.com` |

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
- `platform.js` — Platform detection and webhook payload normalisation (GitHub + GitLab)
- `scheduling.js` — branch state machine, job construction, reconciliation loop
- `sweep.js` — prototype stale-pin sweep logic for `action=sweep`
- `job.json` — K8s Job template
- `test-scheduling.js` — unit tests with mock K8s clients
- `test-sweep.js` — stale-pin classifier tests
- `test-gitlab.js` — GitLab payload parsing and env injection tests
- `sa.kubeconfig` — service account credentials for K8s access (not in git)
