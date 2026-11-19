---
name: rollout-and-test
description: Ship a change to the build.fhir.org pipeline (job template, ig-build or localdev image, trigger, ci-build) and prove autobuild still works, testing in isolation on the real cluster first. Use when rolling out a fix, a new image, a toolchain pin update or a job setting.
---

# Rolling out and testing build pipeline changes

The procedures live in the operator docs; this skill is the order to follow
and the traps that aren't obvious from them.

- `k8s/dev-setup.md`, "Recurring tasks": step 5 (ig-build image), 5b (localdev
  release), 6–8 (ci-build, Caddy).
- `images/ig-publisher/README.md`: toolchain pins, where each image is
  published, how image changes are tested.
- `triggers/ig-commit-trigger/README.md`: "Isolated test against production"
  and "Deploy".

## Order

1. **Pick the smallest unit that carries the change.** Runtime settings (env
   vars, JVM flags, resources) go in `triggers/ig-commit-trigger/job.json` and
   ship with a trigger deploy, no rebuild. Toolchain updates are pin changes in
   the Dockerfile (`update-pins.sh`; a daily workflow proposes them as a PR).
2. **For image changes, A/B first.** `images/ig-publisher/ab-test.sh` against
   the current image; CI runs the same on native amd64 and arm64 for any PR
   touching `images/ig-publisher/`. Expect identical QA counts and 0 differing
   pages; investigate any difference.
3. **Never test on `latest`.** Merge, take GitHub's
   `ghcr.io/fhir/ig-build:candidate-<sha>` (or build locally), push it to the
   production registry under a dated tag, and retag only after testing.
   GitHub deliberately has no credentials for the production registry; don't
   add any.
4. **Test in isolation on production** with the local trigger, per the trigger
   README. Verify the change itself took effect (job spec, image digest, and
   the publisher's `build.log` on build.fhir.org), not just that a build ran.
5. **Ship it**: retag `latest` or deploy the trigger, then send the test repo
   through the deployed trigger and watch the next real builds
   (`kubectl --context fhir-org -n fhir get jobs --sort-by=.metadata.creationTimestamp`).
   For localdev, promote the tested candidate (dev-setup 5b) and tell IG
   authors about toolchain changes.
6. **Clean up**: delete test tags from the production registry (keep the
   previous `latest` under its dated tag as the rollback) and stop any local
   trigger.

## Traps

- A build job "succeeding" means nothing: the `ig-build` container always
  exits 0 and failed builds are uploaded too, to `branches/<branch>/failure/`.
  Judge a test build by the published `qa.json` timestamp and the absence of a
  `failure/` folder, as the trigger README describes.
- Local stand-ins for the builder must run as the image's own user with its
  own environment. Overriding the user or `NPM_CONFIG_PREFIX` once hid a
  permissions bug that broke every cluster build. `ab-test.sh` does this right.
- The old image only worked because Node's tarball files happen to be owned
  by uid 1000 (= `fhiruser`). Check ownership and writability assumptions
  whenever the way a toolchain is installed changes.
- `git add` of a whole image folder picks up `__pycache__` from local runs of
  the builder; `.gitignore` now covers it, but check `git status` anyway.
- The production kubectl context is `fhir-org`; there is no default context.
- The local trigger reads `job.json` only at startup; restart it after edits.
  Delete leftover `igtest-*` jobs before re-triggering the same branch.
- `pkill -f functions-framework` run from a shell whose command line contains
  that string also kills that shell. Stop the trigger by its task handle or port.
- A test build takes several minutes. Watch it from a background loop rather
  than one long blocking `kubectl wait`.
- Copying a multi-arch image between registries with
  `docker buildx imagetools create` streams every layer through your machine
  (several minutes); the digest stays the same, which is how to check that
  production runs exactly what GitHub built.
