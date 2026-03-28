# Incident Analysis: ansforge/interop-IG-document-core build flood

## What Happened

User **nicolasArnoux** on the **ansforge/interop-IG-document-core** repository was reviewing
PR #102 (`NicolasRessourcesCDA` → `fusionRessourcesCDA`). A collaborator **@Haoura** had left
GitHub PR review suggestions (the built-in "suggestion" feature). Nicolas accepted these
suggestions **one at a time**, and each acceptance created an individual commit pushed to the
`NicolasRessourcesCDA` branch.

## Timeline

| Window (UTC) | Commits | Pattern |
|---|---|---|
| Mar 25, 15:57–16:03 | 7 | Mix of "Apply suggestion from @Haoura" and "Update input/fsh/*" |
| Mar 26, 08:48–09:21 | 21 | "Update input/fsh/ResourcesCDACorps/*" (manual edits via GitHub web UI) |
| Mar 26, 14:49–15:19 | ~50 | Mix of "Update" and "Apply suggestion from @Haoura" |
| **Mar 26, 15:15–15:39** | **~80 pushes in 25 min** | **Peak flood — one push every ~15–20 seconds** |

**Total: 100 commits in PR #102** over ~24 hours, with the worst burst being ~80 push events
in 25 minutes on March 26 afternoon.

## Impact on the Build System

During the peak hour (March 26, 15:00–16:00 UTC):
- **137 Cloud Function invocations** (vs. typical ~10–20/hour)
- ~80 of those from `NicolasRessourcesCDA`, ~57 from other repos (normal traffic)

### Why Deduplication Made Things Worse

The trigger code (`triggers/ig-commit-trigger/index.js`) has per-branch deduplication,
but the order of operations is the problem:

```javascript
// 1. List existing jobs for this branch
const existing = await k8sBatch.listNamespacedJob(...)
// 2. Create NEW job  ← immediately requests a 22Gi pod, may trigger node scale-up
const created = await k8sBatch.createNamespacedJob(...)
// 3. THEN kill old jobs  ← Background propagation, not instant
await Promise.all(existing.items.map(i => k8sBatch.deleteNamespacedJob(...)))
```

The new job is created **before** the old one is killed. Each build job requests
**22Gi memory**, and each node is an `e2-highmem-4` with ~28Gi allocatable — so
**one job requires one dedicated GCE VM**. Provisioning a new VM takes 1-2 minutes.

With a webhook arriving every ~15 seconds:
1. Webhook N arrives, creates job N (needs a node), then kills job N-1
2. Job N-1's node is being torn down, but job N's node is still provisioning
3. Webhook N+1 arrives 15s later, creates job N+1 (needs *another* node), kills job N
4. Job N's node was just starting up — now it's wasted

This creates a **pileup of provisioning nodes** that are never used. The on-demand
node pool has a max of 3 nodes, so this quickly hits `GCE out of resources` and
`max node group size reached`, blocking builds for all other users.

### Effect on Other Users

John Moehrke reported:
- His IG builds took 40–50 minutes (vs. normal ~10–15 min)
- Some builds never completed and had to be force-resubmitted
- The cluster was resource-constrained from the constant job churn

## Resolution

- **David Otasek** (dotasek) contacted the ansforge team via GitHub issues
  (see issues on ansforge/interop-IG-document-core)
- They were asked to stop making individual commits
- PR #102 was eventually merged on March 26 at 20:48 UTC
- The `NicolasRessourcesCDA` branch was deleted at 20:49 UTC
- Content was consolidated into `fusionRessourcesCDA` branch, then merged to `main`
  via PR #104 on March 27 at 09:31 UTC
- The Job template has also been tightened to use
  [`terminationGracePeriodSeconds: 0`](/home/jmandel/work/auto-ig-builder/triggers/ig-commit-trigger/job.json#L13)
  so hard cancels release node capacity as quickly as Kubernetes allows
- Recommended remediation design is documented in
  [SOLUTION.md](/home/jmandel/work/auto-ig-builder/investigations/2026-03-27-ig-trigger-concurrency/SOLUTION.md)

## Root Cause

**Not malicious.** The user was using GitHub's built-in PR suggestion feature, accepting
code review suggestions one by one. Each acceptance creates a commit and push event.
GitHub does not batch these into a single commit.

The trigger's "create-then-kill" ordering meant that rapid commits on the same branch
caused a pileup of node provisioning requests, exhausting cluster capacity even though
only the latest build was actually needed.

## Problem Statement for Fix Design

### Goal

Ensure that rapid commits on a single branch cannot exhaust cluster capacity. At most
one build job (and therefore one node) should be active per branch at any time, even
under a flood of webhooks.

### Execution Environment Constraints

The trigger runs as a **Google Cloud Function** — a stateless HTTP handler. Key properties:

- **No shared memory between invocations.** Each webhook delivery is an independent
  function execution. There is no in-process lock, mutex, or singleton we can use.
- **Concurrent execution.** GCF can (and does) run multiple invocations of the same
  function in parallel. During the incident, invocations overlapped heavily.
- **Short-lived.** Each invocation runs for < 1 second normally. The only durable
  shared state is the Kubernetes API.
- **No ordering guarantees.** Webhooks may arrive out of order or be retried by GitHub.

### The Core Invariant We Need

> For a given branch (identified by `job-group-id`), at most **one** K8s Job should
> exist at any time.

If this invariant holds, then:
- At most one node is consumed per branch (each job needs a dedicated 22Gi node)
- Rapid commits cause kill→create cycles on the same node, not a pileup of new nodes
- Other branches' builds are unaffected

### Why the Current Code Violates This

Current order: **list → create → delete old**

The new job is created before the old one is killed. For any two webhooks that overlap:
- Both create jobs, briefly producing 2 (or more) jobs for the same branch
- Each job requests its own node
- The deletes happen after creation, so the node provisioning is already in flight

### Why a Simple Reorder (kill → wait → create) Has Race Conditions

If we simply reverse to **list → delete → wait → create**, concurrent invocations
can still produce duplicates:

**Scenario: Two webhooks arrive 2 seconds apart for the same branch**

```
Time   Invocation A (commit aaa)         Invocation B (commit bbb)
─────  ─────────────────────────────     ─────────────────────────────
t=0    list → finds [job-old]
t=2                                      list → finds [job-old]
t=3    delete job-old
t=4                                      delete job-old (409 or no-op, fine)
t=5    poll... job-old still dying
t=6                                      poll... job-old still dying
t=8    poll... job-old gone!
t=8    create job-aaa ✓
t=9                                      poll... job-old gone!
t=9                                      create job-bbb ✓
       ↑ NOW TWO JOBS EXIST: job-aaa and job-bbb
```

### What Needs To Be True for a Fix To Be Safe

1. **No two creates for the same job-group-id can both succeed without one of them
   subsequently cleaning up.** Either the creates must be serialized (one sees the
   other's job and aborts), or there must be a reliable post-create reconciliation.

2. **The "latest commit wins" semantic must hold.** If commits aaa and bbb arrive
   (bbb is newer), the system must eventually converge to running only bbb's build.
   It is acceptable if aaa's build runs briefly before being replaced.

3. **No webhook should be silently dropped.** If a webhook arrives while we're in a
   wait loop for a previous deletion, the new commit must eventually get built. (It's
   fine if an intermediate commit is skipped — only the latest matters.)

4. **The fix must not add latency to the common case.** First commit on a branch
   (no existing job) should create immediately with no delay.

5. **The fix must not depend on Cloud Function invocations being serialized.**
   Concurrent invocations for the same branch must be safe.

6. **Failure modes must be bounded.** If the wait-for-deletion times out, or a K8s
   API call fails, the system should not get stuck. A build might fail, but the
   system should recover on the next webhook.

### Design Space

Some approaches to consider (not exhaustive):

**A. Kill-wait-create with post-create reconciliation.**
Reverse the order to kill→wait→create, and after creating, list jobs for the group
again. If there are multiple (concurrent invocation also created one), delete all but
the newest. This handles the race in the scenario above: both A and B create, but
both also run the post-create check, and one of them cleans up the other. There's
still a narrow TOCTOU window where both check before either deletes, but the damage
is bounded to 2 jobs briefly coexisting (vs. 80 in the current code).

**B. Kubernetes-native leader election / locking.**
Use a K8s ConfigMap or Lease as a per-branch lock. The invocation that acquires the
lock is the one that gets to create the job. Others either wait or abort. Adds
complexity and a new failure mode (lock not released).

**C. External queue with a single consumer.**
Instead of having the Cloud Function create K8s jobs directly, have it write to a
queue (Pub/Sub, Cloud Tasks). A single worker consumes the queue and manages the
kill-wait-create cycle serially. Eliminates concurrency entirely but adds
infrastructure.

**D. Debounce at the Cloud Function level.**
On receiving a webhook, record the intent (e.g., in Firestore or a ConfigMap) with a
timestamp. A separate periodic process checks for intents older than N seconds and
creates the build. Collapses rapid commits into one build. Adds latency to all builds
(even first commits on a branch).

**E. Optimistic create with leader-wins reconciliation.**
Keep the create-first approach but add a post-create list+cleanup step. Simpler than
kill-wait-create because there's no polling loop, but doesn't solve the node pileup
problem (the briefly-coexisting jobs still trigger node provisioning).

### Considerations for Evaluation

- **Simplicity**: The Cloud Function is currently ~110 lines. How much complexity
  does the fix add?
- **New infrastructure**: Does the fix require new GCP services (Pub/Sub, Firestore,
  Cloud Tasks)?
- **Common-case latency**: Does the first build on a branch get slower?
- **Failure modes**: What happens if the fix's mechanism fails (lock stuck, queue
  down, timeout)?
- **Testability**: Can we test the fix locally without deploying to the live cluster?
