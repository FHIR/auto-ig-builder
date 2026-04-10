# Solution: GCF-Only Branch-Head Scheduling with Same-Node Successors

## Summary

This solution keeps scheduling logic in the Google Cloud Function and uses Kubernetes
Jobs themselves as the only durable branch state.

It does **not** require:

- an in-cluster controller loop
- a ConfigMap
- a queue
- exact-SHA build pinning

Instead, it relies on four ideas:

1. Builds stay **branch-head based**
2. For each branch, there is at most:
   - one current Job
   - one queued successor Job
3. A successor is created **immediately** on preemption, but pinned to the **same node**
   as the current Job
4. Newer webhook deliveries update the queued successor's **intent annotations** instead
   of creating more Jobs

The result should be:

- one branch cannot explode into many 22Gi pods
- a noisy branch consumes at most one running slot and one queued placeholder
- we do not depend on in-cluster reconciliation loops to create the replacement later

## Why This Fits the Current Build Model

The current build is already branch-head based:

- the trigger passes `IG_ORG`, `IG_REPO`, and `IG_BRANCH`
- the builder clones `--branch <branch>`

So today a Job builds whatever is at branch HEAD when the clone actually happens.

This solution keeps that model intentionally.

That means:

- Job env does **not** need to change on every webhook
- a pending successor can be retargeted by changing only annotations
- when the successor finally starts, it naturally builds the latest branch head visible at startup

## Topology

### 1. GitHub -> GCF bridge

The existing trigger in [index.js](../../triggers/ig-commit-trigger/index.js)
remains the ingress point.

Its job becomes:

- authenticate/parse webhook
- resolve current branch HEAD from GitHub
- inspect current Jobs and Pods for that branch
- create or patch successor Jobs and cancel incumbent Jobs as needed
- return success only after the desired state change is durably represented in Job state

### 2. Kubernetes Jobs remain the workers

The heavy IG build still runs in a Kubernetes Job based on
[job.json](../../triggers/ig-commit-trigger/job.json).

There is no separate long-running scheduler pod in this design.

## Core Invariant

For each branch:

- at most one active Job may be running
- at most one successor Job may be queued

Never:

- multiple running Jobs for the same branch
- multiple queued successors for the same branch
- a successor placed on a different node than the incumbent unless we intentionally relax the rule later

## Why Same-Node Successors Matter

Each build requests `22Gi` of memory in
[job.json:45](../../triggers/ig-commit-trigger/job.json#L45),
which effectively means one build per node.

If a newer webhook arrives while a branch is already building, the bad outcome is:

- create a new Job on a different node
- trigger a new autoscaling/provisioning request
- cancel the old one later

That is the node-pool blowup we want to avoid.

Instead, the successor should be created with **hard node affinity** to the current
Job's node. That way:

- it exists immediately as durable successor state
- it cannot consume a second build node
- it remains pending until the old Job releases that same node

## Branch State Lives in Jobs

There is no ConfigMap.

The durable state for a branch is represented by its retained Jobs and their
labels/annotations.

This is safe as long as the GCF only acknowledges a webhook after one of these has happened:

- a new Job was created
- or an existing queued/current Job was patched with newer desired intent

In other words:

- no ack before durable Job state exists

One additional rule:

- `AlreadyExists` is not success by itself

If a create gets `409 AlreadyExists`, GCF should immediately reread branch state and
continue reconciliation. The only acceptable reasons to return success are:

- the desired current/successor Job now exists
- or the intended patch was durably applied

This keeps concurrent webhook bursts from turning slot conflicts into silent no-ops.

## Job Naming

Because we may have both a current Job and a queued successor at the same time, names
should not be generation-based-only.

Recommended scheme:

- `igbuild-<slug>-<shortHash>-a`
- `igbuild-<slug>-<shortHash>-b`

These are branch-local alternating slots.

Where:

- `slug` is a normalized, truncated human-readable form of `org-repo-branch`
- `shortHash` is a stable short hash of the full `org/repo/branch` identity

Example:

- `igbuild-hl7-fhir-main-a1b2c3d4-a`
- `igbuild-hl7-fhir-main-a1b2c3d4-b`

Why slots are better than generation in the name:

- a queued successor may be patched forward from generation 42 to 43 to 44 before it starts
- the Job name should not encode stale intent
- there are only ever two Jobs we care about per branch

Why keep the short hash at all:

- raw branch names are not valid Kubernetes resource names without normalization
- different branch names can normalize to the same slug
- long names may need truncation, which can also create collisions

So the readable slug is for operators, and the short hash is the uniqueness guard.

## Labels and Annotations

### Labels

Use labels for selection and coarse grouping.

Recommended labels:

- `build.fhir.org/managed-by=ig-trigger`
- `build.fhir.org/branch-key=<hash>`
- `build.fhir.org/slot=a|b`

### Annotations

Use annotations for mutable branch intent and debugging.

Recommended annotations:

- `build.fhir.org/org`
- `build.fhir.org/repo`
- `build.fhir.org/branch`
- `build.fhir.org/intent-generation`
- `build.fhir.org/intent-head-sha`
- `build.fhir.org/source-delivery-id`
- `build.fhir.org/source-received-at`
- `build.fhir.org/pinned-node`
- `build.fhir.org/role=current|successor`
- `build.fhir.org/preempted-by-generation`
- `build.fhir.org/preempt-requested-at`
- `build.fhir.org/observed-head-sha`
- `build.fhir.org/publish-status`

The important split is:

- env vars drive execution and remain branch-based
- annotations express controller intent and can be patched forward

## Execution Inputs vs Intent

The build Job env stays simple:

- `IG_ORG`
- `IG_REPO`
- `IG_BRANCH`

No exact commit SHA is required in this design.

The mutable intent lives only in annotations:

- `intent-generation`
- `intent-head-sha`

So for a queued successor:

- pod spec does not change
- env does not change
- only controller-owned annotations change

This is the main simplification that makes the design workable in GCF alone.

## Optional Observability Annotation

Because the build remains branch-head based, `intent-head-sha` is not the same thing as
"the exact commit the build cloned."

If we want auditability later, the build can write:

- `build.fhir.org/observed-head-sha`

after clone.

That is optional and diagnostic only. It is not required for scheduling logic.

## Pod Placement

### Initial build on an idle branch

When a branch has no Jobs:

- create one Job normally
- do not pin it to any node

### Successor build on a busy branch

When a branch already has a current Job bound to node `N`:

- create the successor Job immediately
- add hard node affinity to `N`
- record `pinned-node=N` in annotations

Recommended mechanism:

- `requiredDuringSchedulingIgnoredDuringExecution` node affinity on the node hostname label

This should make the successor:

- schedulable only on node `N`
- pending until the current Job releases resources on `N`
- unable to trigger a second build node for that branch

### Stale placement recovery

Same-node pinning is the preferred handoff, not an infinite requirement.

If a queued successor is:

- still unbound to any node
- still pinned to a specific prior node
- and older than a bounded threshold

then the scheduler should treat that as stale placement and recover by:

- deleting the stuck queued successor
- recreating it unpinned
- preserving the latest `intent-*` annotations

This covers cases where the original node disappeared, was replaced, or otherwise
stopped being a realistic placement target. A reasonable first threshold is 3 minutes:
longer than normal scheduler churn, but much shorter than waiting for
`activeDeadlineSeconds`.

### Periodic stale-pin sweep

The webhook path alone is not sufficient to recover a stale pinned successor on a quiet
branch. If the last webhook for a branch created a pinned successor and the pinned node
then disappeared, no later webhook may arrive to trigger State E recovery.

So this design also needs a small periodic sweep action, invoked on a schedule
(`Cloud Scheduler` -> HTTP call -> the same GCF trigger, using `action=sweep`), whose
only purpose is to find and repair stale pinned successors.

Functional requirements:

- run on a short fixed interval, such as every 1 to 5 minutes
- be safe and idempotent to invoke concurrently or repeatedly
- inspect only Jobs labeled `build.fhir.org/managed-by=ig-trigger`
- act only on Jobs annotated `build.fhir.org/role=successor`
- reconstruct branch-local state the same way the webhook handler does
- never act on a branch that still has a bound/running current Job

A Job is a stale-pin recovery candidate only if all of the following are true:

- it is the only non-terminal Job for its branch
- its pod is still `Pending`
- its pod is unbound (`spec.nodeName` absent)
- `PodScheduled` is still `False`
- it has `build.fhir.org/pinned-node`
- its age is greater than the stale-pin threshold
- and there is evidence that the pin is the blocker, not ordinary cluster pressure

The final condition should be satisfied by either:

- the pinned node no longer exists in the cluster
- or the pod remains unschedulable due to node affinity mismatch

"Node affinity mismatch" here means evidence such as:

- repeated `FailedScheduling` events containing `didn't match Pod's node affinity/selector`
- autoscaler marks the pod unhelpable, such as
  `cloud.google.com/cluster_autoscaler_unhelpable_until=Inf`

The sweep must not unpin just because a pod has been pending for 3 minutes. In
particular, it must not act on:

- an initial unpinned branch build waiting for ordinary capacity
- a queued successor whose current Job is still alive
- a pod whose scheduling failures are only about general capacity, taints, or quota

When a stale-pin candidate is found, the sweep should:

- delete the stuck queued successor Job
- recreate the branch's queued Job without node affinity
- preserve the latest branch intent annotations
- log the branch, prior pinned node, and recovery action

This should reuse the same branch-state reduction and Job-construction helpers as the
webhook path, rather than introduce a second scheduling algorithm.

## Branch State Reduction

On every webhook, GCF should reconstruct branch state from Jobs and Pods.

For a given branch, list Jobs by `branch-key`, then inspect their Pods and reduce them to:

- `current`: the active Job whose pod is currently bound/running
- `queued`: at most one non-terminal successor Job
- `extras`: any additional Jobs for the branch

Useful distinctions:

- `bound current`: pod has `spec.nodeName`
- `queued successor`: pod not yet running, usually still pending, with `pinned-node`
- `pending-only`: one Job exists but has not started/bound yet
- `stale queued successor`: queued successor is still unbound past the stale-placement threshold

`extras` should be cleaned up aggressively.

## Canonical Branch States

### State A: Idle

- no non-terminal Jobs

Action:

- create an initial Job in one slot

### State B: Single pending/unbound Job

This is typically a branch whose first Job has been created but not yet started.

Action on newer webhook:

- patch this same Job's `intent-*` annotations forward
- do not create another Job

Because the Job has not started yet, branch-head semantics mean it will naturally
build the latest head when it does start.

### State C: Single bound/running Job

Action on newer webhook:

1. create successor in the other slot
2. pin successor to the current node
3. set successor `intent-*` annotations to latest branch head
4. hard-cancel the current Job
5. ack only after successor creation succeeds and cancellation is issued

### State D: Running Job + queued successor

Action on newer webhook:

1. patch the queued successor's `intent-*` annotations forward
2. ensure the running Job is still marked for preemption/cancellation
3. do not create another Job

This is the flood-collapse path.

### State E: Queued successor only

This can happen after the old Job has been canceled and the successor exists but has
not started yet.

Action on newer webhook:

- patch the queued successor's `intent-*` annotations forward

No additional Job is needed.

If the queued successor is stale by the rule above, then instead:

- delete the stale queued successor
- recreate it without node affinity
- preserve the latest branch intent

## Event Handling Algorithm

For each webhook:

1. Parse org/repo/branch
2. Resolve the branch's **current HEAD SHA** from GitHub
3. List Jobs for the branch
4. Inspect their Pods
5. Reduce to canonical state
6. Apply the state-specific action above
7. Clean up extras
8. Return success only after the durable Job state mutation succeeds

The important choice here is:

> use latest observed branch head, not raw webhook `after`, as the target intent

That keeps delayed or out-of-order deliveries from moving branch intent backward.

## Concurrency Handling

This design relies on Kubernetes object names as the branch-local concurrency guard, but
it should not treat create conflicts as a correctness shortcut.

Expected burst behavior for many concurrent GCF invocations on the same branch:

- one invocation wins the create for slot `a` or `b`
- the rest may see `409 AlreadyExists`
- those losers must reread Jobs and Pods, then continue from the new canonical state

In other words:

- `AlreadyExists` means "state changed under us"
- not "we are done"

This is what lets the design collapse many simultaneous webhook deliveries onto one
current Job plus at most one queued successor.

## Preemption / Cancellation

Preemption is a **hard cancel**.

That means:

- once a successor exists, the old current Job is no longer authoritative
- correctness does not depend on waiting for the old Job object to disappear
- cleanup of the old Job is operational follow-through, not the state handoff itself
- the durable state has already moved to the successor

Operationally:

1. create successor
2. patch successor with latest `intent-*`
3. issue hard cancel on current Job
4. let the queued successor start once the node frees up

To support that, the Job template should explicitly set
[`terminationGracePeriodSeconds: 0`](../../triggers/ig-commit-trigger/job.json#L13)
so pod termination does not sit on the default grace window.

The important point is that this solution is **not** defined in terms of Kubernetes
deletion propagation details. We should be able to reason about correctness without
talking about "foreground" vs "background" handling:

- successor creation is the durable handoff
- cancellation stops the incumbent
- cleanup happens afterward and may lag

That is simpler than a handoff model where the old Job must be retained until later.

## Bounded Waiting

This design should avoid long waits, but one short bounded wait is acceptable:

- waiting for a fixed slot name `a` or `b` to become actually reusable

This is only needed when:

- we need to create a Job
- neither slot name is free yet
- and Kubernetes is still finishing deletion of an older Job object

Recommended behavior:

- first, prefer any slot name that is already free
- only if neither slot is free, poll Kubernetes for actual slot availability
- use short intervals such as 500ms to 1s
- cap the wait to roughly 10-20 seconds
- stop immediately once one slot becomes reusable and continue reconciliation

What this wait is **not** for:

- waiting for the old pod to finish publishing
- waiting for the old Job object to disappear before successor creation in the normal case
- waiting for the successor build to complete

This is a narrow fallback for slot reuse, not a general scheduling loop.

## Publish Behavior

There is no special publish handshake in this design.

The rule is:

- if a Job reaches publish and has not been canceled, it may publish
- if a newer webhook arrives, that newer webhook preempts by creating/updating the successor and canceling the current Job

So freshness is enforced operationally by preemption, not by a separate publish lease.

## Flood Behavior

This design handles a rapid push flood by collapsing everything onto the queued successor.

Example:

1. branch Job `a` is running on node `N`
2. webhook for newer head arrives
3. GCF creates Job `b`, pinned to `N`, intent=`g42`
4. GCF hard-cancels Job `a`
5. before `b` starts, another webhook arrives
6. GCF patches Job `b` intent -> `g43`
7. another webhook arrives
8. GCF patches Job `b` intent -> `g44`
9. node `N` frees up
10. Job `b` starts and builds current branch head

Result:

- only one running build ever consumed node resources
- only one queued successor existed
- intermediate intents collapsed naturally

## Restart Rehydration

There is no separate state store to load.

On each webhook after a restart, GCF reconstructs state from current Jobs and Pods:

- current running/bound Job, if any
- queued successor, if any
- slot usage
- current intent from annotations

This is sufficient because the design always acks only after Job state has been created or patched.

What this design does **not** try to preserve:

- pending intent for a fully idle branch with zero Jobs

That is acceptable here.

## Cleanup Policy

Cleanup should be minimal, aggressive, and clearly separated from handoff.

Recommended:

- keep the current Job
- keep at most one queued successor
- delete extras immediately
- once the old current Job is canceled and the successor exists, the old Job can go away
- once the branch is idle and the active Job is finished, normal TTL cleanup is fine

Steady state should be:

- idle branch: zero Jobs
- active branch with no preemption: one Job
- active branch during handoff: two Jobs

Never more than two non-terminal Jobs per branch.

Because this design is GCF-only, active cleanup happens on webhook invocations. Finished
Jobs do not need to be retained as durable intent and can be cleaned up by TTL.

One important constraint:

- do not make correctness depend on immediate slot-name reuse after delete

In particular, if a terminal Job still occupies slot `a` or `b`, the scheduler should
treat that as a real occupied name for this invocation. It should not assume "delete,
then immediate recreate with the same name" will succeed. Slot reuse should happen only
when Kubernetes actually makes the name available again.

If neither slot becomes available within the bounded polling window, the invocation
should fail visibly rather than return success with no created or patched Job.

## Required Manifest / Code Changes

### Trigger / GCF

- stop doing `list -> create -> cancel old` directly per commit without state reduction
- add branch state reduction over Jobs + Pods
- resolve branch HEAD before choosing intent
- create pinned successor Jobs on preemption
- patch queued successor annotations forward on repeated webhooks
- detect stale pinned queued successors and recreate them unpinned
- on `409 AlreadyExists`, reread and reconcile instead of returning success immediately
- when no slot name is reusable, do short bounded polling for actual slot release
- keep cleanup and slot reuse separate from correctness-critical handoff
- add a periodic authenticated sweep entrypoint that repairs stale pinned successors on
  quiet branches

### Job Template

- add labels/annotations described above
- add hard node affinity when creating a successor
- set `terminationGracePeriodSeconds: 0` so preempted Jobs give up node resources quickly

`ttlSecondsAfterFinished` does not need to be removed in this design. Terminal Jobs are
not the source of truth for future idle-branch intent, so normal TTL cleanup is fine.

### Builder

No exact-SHA checkout is required for this solution.

The build can remain branch-head based.

Optional future improvement:

- write `observed-head-sha` annotation after clone for audit/debugging

## Why This Is Better Than the Current Trigger

The current trigger fails because every webhook can create a fresh large Job with no
regard for where the prior one is running.

This solution changes that:

- first build gets a normal Job
- preemptions reuse the same node by construction
- repeated webhook floods mutate one queued successor instead of creating more Jobs

So even if webhook timing is chaotic, the branch does not fan out into many nodes.

## Tradeoffs

- branch-head semantics are preserved instead of moving to exact-SHA builds
- same-node pinning remains the preferred fast path, but stale-placement fallback adds a little more scheduler logic
- there is no remembered desired intent for a fully idle branch with zero Jobs
- correctness is "latest observed branch head wins operationally," not "every webhook SHA is built exactly"

These tradeoffs are acceptable if the immediate goal is:

- stop blowing up the node pool
- preserve a clean and understandable design

## Recommendation

If we want the simplest design that:

- stays mostly inside the existing Google Cloud Function
- uses Jobs as the only durable state
- avoids in-cluster reconciliation loops
- and keeps one noisy branch from consuming multiple build nodes

then the recommended design is:

> GCF-only branch-head scheduling with at most one same-node queued successor per branch

That is the cleanest next step from the current system.
