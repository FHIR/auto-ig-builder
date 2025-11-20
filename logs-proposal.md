# CI Build Log Streaming Proposal

## Problem & Goal
Builders write `build.log` to a shared volume, but there is no live view; users must wait for the static `build.log` to publish. We want a **best-effort, in-cluster** way to stream logs for a repo/branch without introducing external dependencies. Builds must continue even if streaming is down.

## Non-goals / Constraints
- No reliance on GCP services (Pub/Sub, Logging, etc.).
- Do not block or slow builds if streaming breaks.
- External API should be by org/repo/branch; job IDs stay internal.
- Clients can choose start position (`start` vs `tail`) and whether to `follow`; no “latest vs inprogress” switch.

## Current Pipeline (relevant bits)
- Build Job writes `/scratch/build.log`.
- `watch-and-publish` uploads artifacts to the long-lived `ci-build` pod (Caddy + reindexer) on the shared PD, which Caddy serves.

## Proposed Design
Add a **log relay container** to the `ci-build` Deployment and a **tiny sidecar** to each build Job. Expose the relay via an internal-only ClusterIP Service; no public listener or Caddy proxy by default.

### Data flow
1. Build Job sidecar tails `/scratch/build.log` and POSTs lines to the relay in `ci-build` at `http://log-relay.fhir.svc.cluster.local:4000` (ClusterIP).
2. Relay appends to per-branch log files on the shared PD and updates a small index for branch → current file.
3. Clients call SSE endpoints (by org/repo/branch) to read existing content and optionally follow live appends.
4. A cleanup loop in the relay deletes old log files/index entries by mtime (TTL).

### Storage layout (shared PD)
- Logs: `/var/www/log-buffers/<org>__<repo>__<branch>__<ts>.log`
  - `<ts>`: RFC3339 or epoch seconds at first append.
- Index file: `/var/www/log-buffers/index.json` (atomic rewrite)
  - Maps `{ "<org>/<repo>/<branch>": { "logFile": "...", "updatedAt": "...", "done": bool } }`
  - On each append, update `updatedAt`; on `done`, set `done=true`.

### Ingest API (internal only, used by build sidecar)
- `POST /ingest/<org>/<repo>/<branch>` body=`text/plain`
  - Appends body (ensure trailing `\n`) to the active log file for the branch, creating it if needed.
- `POST /ingest/<org>/<repo>/<branch>?done=1`
  - Marks file as done in the index (optional sentinel write).
- Behavior if relay is down: sidecar ignores errors; build continues; static `build.log` still publishes.

### SSE API (for dashboard/users; internal-only unless a separate public Service/Ingress is created)
- `GET /sse/<org>/<repo>/<branch>?start={start|tail|bytes:N}&follow={true|false}`
  - start:
    - `start` (default): stream from file beginning.
    - `tail`: start at EOF and only send new lines.
    - `bytes:N`: send last N bytes then follow.
  - follow (default `true`): continue tailing; if `false`, stop at EOF of current file.
- File resolution:
  - Prefer a log marked `!done` for that branch if it exists; else pick newest by `updatedAt`.
  - If no file exists, 404.
- Termination:
  - If `done=true` and `follow=true`, SSE ends when file ends (plus short grace).
  - If log file is deleted during streaming, SSE closes cleanly.

### Cleanup
- Interval: configurable (e.g., every 15–30 minutes).
- Delete any log file whose mtime is older than TTL (e.g., 24–72h); remove matching index entries.
- If cleanup fails, nothing blocks builds; files fall off on next pass.

## Changes Needed
1) **ci-build Deployment**
   - Add `log-relay` container:
     - Image: small HTTP server (Go/Node/Python) exposing port 4000.
     - Mount the same PD as Caddy at `/var/www` (or subdir) to read/write `log-buffers`.
     - Env/config: `LOG_DIR=/var/www/log-buffers`, `TTL_HOURS`, `CLEAN_INTERVAL`, `PORT`.
   - Add a dedicated `log-relay` ClusterIP Service (port 4000) for in-cluster access only. Do not expose on the public LoadBalancer Service.

2) **Build Job template (triggers/ig-commit-trigger/job.json)**
   - Add sidecar container (e.g., `log-forwarder`) with:
     - `tail -F /scratch/build.log | while read line; do curl -sS -m 2 -XPOST "$RELAY/ingest/<org>/<repo>/<branch>" --data-binary "$line" || true; done; curl -sS -m 2 -XPOST "$RELAY/ingest/<org>/<repo>/<branch>?done=1" || true`
     - Env: `RELAY=http://log-relay.fhir.svc.cluster.local:4000`, plus `IG_ORG/IG_REPO/IG_BRANCH` already present.
     - Volumes: reuse `/scratch` from the main builder; no PD mounts.
   - Add network policy adjustment if needed to allow egress to the ClusterIP Service.

3) **(Optional) External access**
   - Default: internal-only via the `log-relay` ClusterIP; dashboards inside the cluster consume it.
   - If ever needed externally, add a separate Service/Ingress for the relay; keep the existing public LoadBalancer Service unchanged.

## Functional Requirements
- Logs always publish to static site as today (source of truth).
- Live streaming is best-effort; failures must not impact build success or artifact publication.
- SSE supports `start|tail|bytes:N` and `follow true|false`.
- Branch-based addressing only; jobs remain internal.
- Cleanup ensures bounded disk usage; TTL configurable.

## Operational Notes
- If multiple builds run on the same branch, the relay keeps the newest in-progress; older finished logs remain until TTL expiry.
- Relay restart: files persist on PD; index rebuilt from filenames if needed.
- Observability: relay logs errors but does not backpressure callers.

## Open Questions
- Exact TTL/defaults (e.g., 24h vs 72h).
- SSE buffer sizes/chunking (line-delimited vs raw chunks); default to line-delimited.
- Whether to gzip SSE responses behind Caddy.
