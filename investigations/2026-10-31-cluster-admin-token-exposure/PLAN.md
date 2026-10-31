# Cluster-admin token reachable from build pods: containment plan

## The problem (verified 2026-10-31)

A build pod running untrusted IG content can take over the cluster:

1. **Node credentials are reachable from pods.** Workload Identity is off, so any pod can ask the metadata server
   (`169.254.169.254`) for the node service account's token. That account is
   `1026763011045-compute@developer`. Verified from a pod running the `ig-build`
   image as uid 1000 with RuntimeDefault seccomp: HTTP 200.
2. **That account can read every bucket in the project.** It has project-wide `roles/storage.objectViewer`
   (scope `devstorage.read_only`). That includes the Cloud Functions source
   bucket `gcf-sources-1026763011045-us-central1`; listing it with the node
   token returned HTTP 200.
3. **The function's source holds a Kubernetes token.** Every deploy of `ig-commit-trigger` uploads its source zip, including
   `sa.kubeconfig`. That file holds the long-lived token of the `igbuild` service
   account (legacy secret `igbuild-token-hh2sz`).
4. **That token is cluster-admin.** `igbuild` is cluster-admin through the ClusterRoleBinding
   `kubelet-node-binding` (created 2017-04-24, misleadingly named), plus
   namespace `admin` through `ig-build-rolebinding`.

With cluster-admin an attacker gets every secret (ssh upload key, Zulip, tx API
key), privileged pods and root on every node, and control of build.fhir.org. The
node token alone also reads every other bucket in the project (`tx-fhir-org`,
`storage.packages2.fhir.org`, `fhir-grahame-local`, `devices.fhir.org`, …).
The trigger accepts any GitHub repo, and IG templates can carry their own
scripts, so code execution in a build is assumed.

The bucket is not public: an anonymous read returns 403.

## Status (2026-10-31, steps 1–3 done)

- **Trigger:** Cloud Function version 54 reads its kubeconfig from Secret Manager
  (`ig-trigger-kubeconfig`, mounted at `/etc/ig-trigger/kubeconfig`). Its uploaded
  source contains no credentials (checked).
- **RBAC:** `igbuild` holds only `k8s/ig-trigger.rbac.yaml`. `kubectl auth can-i` confirms
  jobs, pods and events in `fhir` plus node listing, and nothing else.
- **Old token:** `igbuild-token-hh2sz` is deleted. The copy in old source zips now gets
  "Unauthorized".
- **Removed bindings:** saved next to this file (`removed-*.yaml`).
- **Still open:** build pods can still fetch the node token and read every bucket in the
  project (see step 5). That token no longer leads to the cluster.

The node account is the project's shared default compute account, also used by
`tx-fhir-org-64`, `tx-dev-fhir-org`, `www-fhir-org`, `npm-fhir-org`,
`fhir-validator`, `ecosystem-hl7-org` and `core-build-fhir-4`. Its role
`roles/container.nodeServiceAccount` itself includes project-wide
`storage.objects.get/list`. So the fix is to stop pods from reaching the node
token (Workload Identity), not to change that account.

## What the trigger needs

From the code (`scheduling.js`, `sweep.js`):
- `batch/jobs` in `fhir`: create, list, patch, delete, plus get and watch.
- `pods` in `fhir`: list. `events` in `fhir`: list.
- `nodes`: list (the sweep checks that a pinned node still exists).

No pod runs as `igbuild`; the audit logs show only the Cloud Function using it.

## Steps

### 1. Least-privilege RBAC (additive first, no outage)
- [x] Role `ig-trigger` in `fhir` covering the verbs above, and ClusterRole
      `ig-trigger-nodes` (nodes: get, list). Bind both to `fhir/igbuild`.

### 2. A new credential kept out of the source zip
- [x] Enable the Secret Manager API.
- [x] Create a new token secret for `igbuild`, build a kubeconfig from it, and store
      it as Secret Manager secret `ig-trigger-kubeconfig`. Only the function's runtime
      account (`fhir-org-starter-project@appspot.gserviceaccount.com`) gets
      `secretAccessor` on it. The node account has no Secret Manager access.
- [x] Trigger code: read the kubeconfig path from `KUBECONFIG_PATH` (default
      `sa.kubeconfig` for local runs). Add `sa.kubeconfig` to `.gcloudignore`, so it
      can never be uploaded again.
- [x] Deploy with `--set-secrets` mounting the secret as a file. Test with
      `jmandel/ig-build-test` (build, sweep, rejection paths).

### 3. Revoke
- [x] Delete the legacy secret `igbuild-token-hh2sz`. Every copy of the old token,
      including those in old source zips, stops working.
- [x] Delete `kubelet-node-binding` (cluster-admin) and `ig-build-rolebinding`
      (namespace admin).
- [x] Test again: trigger, sweep, and that `igbuild` can no longer read secrets or act
      outside `fhir`.

### 4. Look for past abuse
- [ ] Audit logs of `igbuild` writes, by source IP and user agent, over the
      retention window. Cloud Function egress uses `node-fetch` from Google IPs;
      look for anything else, for any method other than job create/patch/delete,
      and for any write outside `fhir`. Reads (such as secret reads) are not
      audited by default, so a clean result is only partial assurance.

### 5. Close the metadata path (recreates nodes)
- [ ] Enable Workload Identity on the cluster (`--workload-pool=fhir-org-starter-project.svc.id.goog`)
      and set `--workload-metadata=GKE_METADATA` on all three node pools. Pods then
      get no node token. Nothing in `fhir` needs Google credentials.
- [ ] Later, give GKE nodes their own least-privilege service account instead of
      the shared default compute account. That needs new node pools. Image pulls
      need only `artifactregistry.reader` on the `gcr.io` repository, which the
      node account already has.
- [ ] Consider rotating secrets the old token could have read: the ci-build ssh key,
      Zulip bot keys, the tx API key.
- [ ] Disable the kubelet read-only port (10255).

## Rollback
- **RBAC:** re-create the deleted bindings from this file's description. Only do this
  if the trigger breaks and can't be fixed forward.
- **Trigger:** redeploy the previous version from git (`31b1070`). It needs an
  `sa.kubeconfig` file again.
