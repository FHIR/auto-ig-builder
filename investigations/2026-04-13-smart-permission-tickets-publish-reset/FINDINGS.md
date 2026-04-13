# Incident Analysis: smart-permission-tickets-wip build completed but publication remained stale

## Summary

On **April 13, 2026**, the `jmandel/smart-permission-tickets-wip` `main` branch build
completed successfully, but the published branch output on `build.fhir.org` did not update.

This was **not** a CDN issue.

The failure occurred during the **publish handoff** from the `ig-upload` sidecar to the
`ci-build` service:

- the build pod completed normally
- the upload sidecar attempted to stream the result tarball over SSH
- the SSH connection to `ci-build-service:2222` was reset mid-transfer
- the live branch directory on `ci-build` was therefore never replaced
- the system nevertheless logged and notified a **false success**

## What Happened

The auto-build pipeline for an IG branch is:

1. GitHub push webhook triggers the Cloud Function in
   [triggers/ig-commit-trigger/index.js](../../triggers/ig-commit-trigger/index.js)
2. The scheduler creates a Kubernetes Job using
   [triggers/ig-commit-trigger/job.json](../../triggers/ig-commit-trigger/job.json)
3. The `ig-build` container builds the IG
4. The `ig-upload` container waits for `/scratch/done` and then runs
   [images/ig-publisher/ci-files/watch-and-publish](../../images/ig-publisher/ci-files/watch-and-publish)
5. That script calls [images/ig-publisher/ci-files/publish](../../images/ig-publisher/ci-files/publish),
   which streams `tar czf - * | ssh ci-build ./publish-ig ...`
6. The remote [images/ci-build/publish-ig](../../images/ci-build/publish-ig) untars into
   `~/uploading/$TARGET`, swaps the branch directory atomically, and touches a reindex semaphore

In this incident, steps 1-4 succeeded. Step 5 failed in transit.

## Timeline

All times UTC.

| Time | Event |
|---|---|
| `2026-04-13T19:35:59.676Z` | Cloud Function received webhook for `jmandel/smart-permission-tickets-wip@main`, HEAD `285c87ec...` |
| `2026-04-13T19:36:00Z` | K8s Job `igbuild-jmandel-smart-permission-tickets-wip-mai-5e3eb3e8-a` created |
| `2026-04-13T19:36:59Z` | First pod attempt terminated and replaced |
| `2026-04-13T19:37:11Z` | Replacement pod `igbuild-jmandel-smart-permission-tickets-wip-mai-5e3eb3e8-vwjd5` created |
| `2026-04-13T19:40:00.166Z` | `ig-build` container logged `Build succeeded` |
| `2026-04-13T19:40:00.179Z` | `ig-upload` logged `Publish jmandel smart-permission-tickets-wip main success default to CI build from /scratch/upload` |
| `2026-04-13T19:40:00.219Z` | `ig-upload` logged `kex_exchange_identification: read: Connection reset by peer` |
| `2026-04-13T19:40:00.219Z` | `ig-upload` logged `Connection reset by 10.3.255.252 port 2222` |
| `2026-04-13T19:40:00.221Z` | `ig-upload` logged `tar: -: Wrote only 6144 of 10240 bytes` |
| `2026-04-13T19:40:00.222Z` | `ig-upload` still logged `Uploaded; notifying zulip` |
| `2026-04-13T19:40:00.883Z` | `ig-upload` logged `Notified` |
| `2026-04-13T19:40:04Z` | K8s Job marked `Completed` |

## Confirmed Findings

### 1. Triggering and scheduling worked normally

The webhook, HEAD resolution, and job creation path behaved as expected.

Relevant code:

- [triggers/ig-commit-trigger/index.js](../../triggers/ig-commit-trigger/index.js)
- [triggers/ig-commit-trigger/scheduling.js](../../triggers/ig-commit-trigger/scheduling.js)

There is no evidence that the branch was skipped or that the wrong commit was scheduled.

### 2. The IG build itself succeeded

The `ig-build` container logged:

- `Build succeeded`
- `results`

The upload phase was entered because `/scratch/done` existed and
[watch-and-publish](../../images/ig-publisher/ci-files/watch-and-publish) proceeded.

### 3. The publish step failed over SSH

The failing log lines from the `ig-upload` container were:

- `kex_exchange_identification: read: Connection reset by peer`
- `Connection reset by 10.3.255.252 port 2222`
- `tar: -: Wrote only 6144 of 10240 bytes`
- `tar: Child returned status 141`
- `tar: Error is not recoverable: exiting now`

These show that the stream between
[publish](../../images/ig-publisher/ci-files/publish) and the remote
[publish-ig](../../images/ci-build/publish-ig) was interrupted before the upload completed.

### 4. The live branch content on `ci-build` was never updated

Inspection of the publish volume in the running `ci-build` pod showed that:

- `www/ig/jmandel/smart-permission-tickets-wip/branches/main/` still had timestamps from
  the older `2026-04-13 17:07 UTC` build
- `build.log`, `qa.html`, and `index.html` were still the older versions

This means the atomic branch swap in
[publish-ig](../../images/ci-build/publish-ig) never occurred for the `19:40 UTC` build.

### 5. No reindex semaphore was created

The `reindex_queue` directory on `ci-build` was empty.

That is consistent with [publish-ig](../../images/ci-build/publish-ig) never reaching:

```bash
cd ~/reindex_queue
touch reindex_request_$(date --iso-8601=ns).sem
```

### 6. The success notification was false

[watch-and-publish](../../images/ig-publisher/ci-files/watch-and-publish) does **not** use
`set -e` or `set -o pipefail`.

Also, [builder.py](../../images/ig-publisher/ci-files/builder/builder.py) constructs the
success message before the publish handoff happens and includes a `[published]` link for
successful builds.

As a result:

- `publish ...` failed
- the script continued anyway
- the message content still looked like a successful publication
- a success-style Zulip message was sent
- the overall Job still exited successfully

This is the key operational bug exposed by the incident.

## Likely Contributing Cause

At the time of inspection, the `ci-build` pod's `sshd` listener reported:

- `sshd -D [listener] 10 of 10-100 startups`

That is OpenSSH's pre-auth connection-throttling state. It is consistent with transient
handshake resets under concurrent inbound SSH activity.

This does **not** prove that `MaxStartups` was the only cause of the reset, but it is the
most plausible proximate explanation seen during the investigation.

## Root Cause

The immediate cause of the stale publication was:

1. the upload-side SSH stream to `ci-build-service:2222` reset during publish, and
2. the uploader scripts treated this as success instead of failure

The second point is the more serious system bug:

- a transient transport failure should not be indistinguishable from success
- the current implementation hides the failure from operators and from Kubernetes retry behavior

## Impact

- `build.fhir.org/ig/jmandel/smart-permission-tickets-wip/branches/main/` remained stale
- the committers notification stream reported the build as published when it was not
- the build Job was marked completed, so the system did not retry publication
- the discrepancy required manual investigation across Kubernetes, Cloud Logging, and the
  `ci-build` volume

## Conclusion

This incident was caused by a **publish transport failure** plus **failure masking** in the
upload scripts. The build path worked. The live publication path did not.

The short-term fix should focus on:

- failing closed when publish fails
- retrying the SSH publish step
- ensuring Kubernetes sees a real failure if publication still does not complete

The proposed remediation is documented in [SOLUTION.md](./SOLUTION.md).
