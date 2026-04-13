# Solution: fail-closed publish path with bounded retry

## Summary

The current publish path is too brittle in two ways:

1. a transient SSH reset can abort publication
2. the scripts still report success and exit successfully after that failure

The first remediation pass should keep the current transport model but harden it:

- make the uploader fail closed
- add bounded retry around the SSH publish hop
- allow Kubernetes one outer retry if the uploader still cannot publish

This addresses the actual incident without redesigning the pipeline.

## Changes Recommended

### 1. Make the notification path fail closed and truthful

Targets:

- [images/ig-publisher/ci-files/watch-and-publish](../../images/ig-publisher/ci-files/watch-and-publish)
- [images/ig-publisher/ci-files/builder/builder.py](../../images/ig-publisher/ci-files/builder/builder.py)

Current problem:

- it does not use `set -euo pipefail`
- if `publish` fails, the script continues
- the success message content is assembled upstream before publication actually happens
- it sends a success-style Zulip message anyway
- the container exits successfully, so the Job is not retried

Recommended change:

- add `set -euo pipefail` to `watch-and-publish`
- make `builder.py` produce a neutral "rebuilt" message that does not claim publication
- only add publish-success wording after `publish` returns `0`
- if `publish` fails, send a failure notification and exit nonzero

Desired behavior:

- successful build + successful publish -> success notification
- successful build + failed publish -> failure notification and nonzero exit

That makes publication truthfully observable and lets the Job controller help recover.

### 2. Add retry with backoff around the SSH publish hop

Target:

- [images/ig-publisher/ci-files/publish](../../images/ig-publisher/ci-files/publish)

Current problem:

- single `tar | ssh ci-build ./publish-ig ...`
- no retry
- log line says `Publish ... success ...` before the SSH command has actually succeeded

Recommended change:

- replace the current one-shot pipeline with a small retry loop
- add `set -euo pipefail` or explicitly inspect `PIPESTATUS` so failure anywhere in
  `tar ... | ssh ...` fails the attempt
- use a bounded number of attempts, e.g. `3` or `4`
- use exponential backoff plus small jitter
- log `starting publish attempt N/M`
- log `publish completed` only after the SSH command returns `0`

Example policy:

- attempts: `4`
- base delay: `2s`
- backoff: `2s`, `4s`, `8s`
- jitter: `0-2s`

Why retry here:

- the failure happened after the expensive IG build had already completed
- the right retry layer is the transport handoff, not the full rebuild
- [publish-ig](../../images/ci-build/publish-ig) already uses a temp directory plus atomic
  branch swap, so retrying the upload is safe

### 3. Optionally keep a coarse-grained outer Job retry

Target:

- [triggers/ig-commit-trigger/job.json](../../triggers/ig-commit-trigger/job.json)

Recommended change:

- explicitly set `"backoffLimit": 1`

Why:

- the core fix is still truthful nonzero exit from the uploader
- most transient SSH hiccups should be absorbed inside `publish`
- if they are not, one coarse outer retry is still reasonable
- this avoids repeated rebuild loops while still giving the system one second chance

This is an operational policy choice on top of the real fix, not a substitute for it.

### 4. Make logging honest

Targets:

- [images/ig-publisher/ci-files/publish](../../images/ig-publisher/ci-files/publish)
- [images/ig-publisher/ci-files/watch-and-publish](../../images/ig-publisher/ci-files/watch-and-publish)
- [images/ig-publisher/ci-files/builder/builder.py](../../images/ig-publisher/ci-files/builder/builder.py)

Recommended changes:

- change `Publish ... success ...` to something like `Starting publish ...`
- emit a distinct success log only after SSH returns `0`
- emit a distinct failure log on each failed attempt
- include final attempt count and exit status in the terminal failure log
- stop generating `[published]` notification text before publication actually finishes

The incident was harder to understand because the logs declared success before the
network transfer had actually succeeded.

## Optional Hardening After the First Pass

These are not required for the immediate fix, but they would improve resilience:

### A. Tune `sshd` concurrency on `ci-build`

The `ci-build` pod showed:

- `sshd -D [listener] 10 of 10-100 startups`

That suggests pre-auth throttling pressure. If publish traffic is bursty, increasing
`MaxStartups` or otherwise smoothing inbound SSH concurrency could reduce reset frequency.

This should be treated as a follow-up optimization, not as a substitute for fail-closed
behavior and retries.

### B. Emit an explicit remote receipt

The remote [publish-ig](../../images/ci-build/publish-ig) script could write a small
receipt file after the branch swap succeeds, including:

- org
- repo
- branch
- timestamp

The uploader could then treat absence of the receipt as failure.

That is useful, but the current incident can already be addressed without adding it.

## Why Not Redesign the Pipeline Immediately

A more robust architecture would upload build artifacts to durable object storage and run
publication as a separate fetch-and-swap step. That would be cleaner long term, but it is
not needed to address the immediate failure mode.

The current system can be made materially safer with a small patch set:

- fail closed
- retry SSH upload
- keep one outer Job retry

That is the shortest path to correctness.

## Recommended First Patch Set

1. `builder.py` + `watch-and-publish`: stop claiming publication before publish succeeds
2. `publish`: add bounded retry with backoff plus `pipefail`-correct failure handling
3. optionally `job.json`: set `"backoffLimit": 1`

## Expected Outcome

With those changes:

- transient SSH resets should usually be absorbed automatically
- if publish still fails, the Job will fail truthfully
- Kubernetes can retry once
- operators will no longer get false success notifications
- stale published branches will be much easier to diagnose
