---
name: rollout-and-test
description: Ship a change to the build.fhir.org pipeline (job template, ig-build image, trigger, ci-build) and prove autobuild still works, testing in isolation on the real cluster first. Use when rolling out a fix, a new image or a job setting.
---

# Rolling out and testing build pipeline changes

The procedures live in the operator docs; this skill is the order to follow
and the traps that aren't obvious from them.

1. **Pick the smallest unit that carries the change.** Runtime settings (env
   vars, JVM flags, resources) go in `triggers/ig-commit-trigger/job.json` and
   ship with a trigger deploy. Rebuild the image only when its contents change.
   See `k8s/dev-setup.md`, "Recurring tasks", step 5.
2. **Never test on `latest`.** Push images under a dated tag and retag once
   tested (`k8s/dev-setup.md`, step 5).
3. **Test in isolation on production**, following "Isolated test against
   production" in `triggers/ig-commit-trigger/README.md`. Verify the change
   itself took effect, not just that the build passed: read it back from the job
   spec and from the publisher's `build.log` on build.fhir.org, not the container
   log, which doesn't carry Java's output (a JVM prints
   `Picked up JAVA_TOOL_OPTIONS: …`).
4. **Ship it**: "Deploy" in the trigger README, or the retag in step 5. Then
   watch the next real build pick it up
   (`kubectl --context fhir-org -n fhir get jobs --sort-by=.metadata.creationTimestamp`).
   For ci-build restarts, mind the brief outage noted in `k8s/dev-setup.md`.

Traps:

- A build job "succeeding" means nothing: the `ig-build` container always
  exits 0 and failed builds are uploaded too, to `branches/<branch>/failure/`.
  Judge a test build by the published `qa.json` timestamp and the absence of a
  `failure/` folder, as the trigger README describes.
- Local stand-ins for the builder must run as the image's own user with its
  own environment. Overriding the user or `NPM_CONFIG_PREFIX` once hid a
  permissions bug that broke every cluster build (`images/ig-publisher/ab-test.sh`
  does this right).

- The production kubectl context is `fhir-org`; there is no default context.
- The local trigger reads `job.json` only at startup; restart it after edits.
- `pkill -f functions-framework` run from a shell whose command line contains
  that string also kills that shell. Stop the trigger by its task handle or port.
- A test build takes several minutes. Watch it from a background loop rather
  than one long blocking `kubectl wait`.
