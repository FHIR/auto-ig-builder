/**
 * Tests for the branch-head scheduling state machine.
 *
 * Imports the real production scheduling module (scheduling.js) and exercises
 * it with mock K8s clients. No logic is duplicated from the production code.
 *
 * Run:  node test-scheduling.js
 */

import { strict as assert } from "node:assert";
import jobSource from "./job.json" with { type: "json" };
import {
  createScheduler,
  computeBranchKey,
  branchSlug,
  slotName,
  otherSlot,
} from "./scheduling.js";

// ── Mock state ──────────────────────────────────────────────────────────────

let jobs = [];
let pods = [];
const calls = [];
const DEFAULT_MANAGED_BY = "ig-trigger";
const DEFAULT_JOB_PREFIX = "igbuild";

function reset() {
  jobs = [];
  pods = [];
  calls.length = 0;
}

// ── Mock K8s clients ────────────────────────────────────────────────────────

const k8sBatch = {
  listNamespacedJob: async ({ labelSelector }) => {
    calls.push({ op: "listJobs", labelSelector });
    const matched = jobs.filter((j) => {
      if (labelSelector.includes("build.fhir.org/managed-by=")) {
        const managedBy = labelSelector.match(
          /build\.fhir\.org\/managed-by=([^,]+)/
        )?.[1];
        const key = labelSelector.match(
          /build\.fhir\.org\/branch-key=([^,]+)/
        )?.[1];
        return (
          j.metadata?.labels?.["build.fhir.org/managed-by"] === managedBy &&
          j.metadata?.labels?.["build.fhir.org/branch-key"] === key
        );
      }
      if (labelSelector.includes("job-group-id=")) {
        const key = labelSelector.match(/job-group-id=([^,]+)/)?.[1];
        return j.metadata?.labels?.["job-group-id"] === key;
      }
      return false;
    });
    return { items: matched };
  },

  createNamespacedJob: async ({ body }) => {
    calls.push({ op: "createJob", name: body.metadata.name });
    if (jobs.some((j) => j.metadata.name === body.metadata.name)) {
      const err = new Error("already exists");
      err.body = {
        message: `jobs.batch "${body.metadata.name}" already exists`,
      };
      throw err;
    }
    const j = JSON.parse(JSON.stringify(body));
    j.metadata.creationTimestamp = new Date().toISOString();
    j.status = {};
    jobs.push(j);
    return j;
  },

  patchNamespacedJob: async ({ name, body }) => {
    calls.push({
      op: "patchJob",
      name,
      annotations: body?.metadata?.annotations,
    });
    const j = jobs.find((j) => j.metadata.name === name);
    if (!j) throw new Error(`Job ${name} not found`);
    Object.assign(j.metadata.annotations, body.metadata.annotations);
    return j;
  },

  deleteNamespacedJob: async ({ name }) => {
    calls.push({ op: "deleteJob", name });
    jobs = jobs.filter((j) => j.metadata.name !== name);
    pods = pods.filter((p) => p.metadata?.labels?.["job-name"] !== name);
    return {};
  },
};

const k8sCore = {
  listNamespacedPod: async ({ labelSelector }) => {
    calls.push({ op: "listPods", labelSelector });
    const jobName = labelSelector.match(/job-name=(.+)/)?.[1];
    const matched = pods.filter(
      (p) => p.metadata?.labels?.["job-name"] === jobName
    );
    return { items: matched };
  },
};

// ── Create the scheduler under test (uses real production code) ─────────────

function makeScheduler(overrides = {}) {
  return createScheduler({
    k8sBatch: overrides.k8sBatch || k8sBatch,
    k8sCore: overrides.k8sCore || k8sCore,
    jobSource,
    managedByLabel: overrides.managedByLabel || DEFAULT_MANAGED_BY,
    jobNamePrefix: overrides.jobNamePrefix || DEFAULT_JOB_PREFIX,
    branchKeyScope: overrides.branchKeyScope || "",
    opts: { slotPollIntervalMs: 10, slotPollTimeoutMs: 200, ...overrides.opts },
  });
}

const defaultScheduler = makeScheduler();

// ── Helpers to set up cluster state ─────────────────────────────────────────

function addJob(name, branchKey, slot, opts = {}) {
  const job = {
    metadata: {
      name,
      creationTimestamp: opts.createdAt || new Date().toISOString(),
      labels: {
        "build.fhir.org/managed-by": opts.managedBy || DEFAULT_MANAGED_BY,
        "build.fhir.org/branch-key": branchKey,
        "build.fhir.org/slot": slot,
        "job-group-id": branchKey,
      },
      annotations: {
        "build.fhir.org/role": opts.role || "current",
        "build.fhir.org/intent-head-sha": opts.headSha || "aaa",
        ...(opts.annotations || {}),
      },
    },
    status: opts.status || {},
  };
  jobs.push(job);
  return job;
}

function addPod(jobName, opts = {}) {
  pods.push({
    metadata: { labels: { "job-name": jobName } },
    spec: { nodeName: opts.node || null },
    status: { phase: opts.phase || "Pending" },
  });
}

function isTerminal(job) {
  if ((job.status?.succeeded || 0) > 0) return true;
  return (job.status?.conditions || []).some(
    (c) => c.type === "Failed" && c.status === "True"
  );
}

// ── Shorthand ───────────────────────────────────────────────────────────────

const ORG = "testorg",
  REPO = "testrepo",
  BRANCH = "main";
const BKEY = computeBranchKey(ORG, REPO, BRANCH);
const SLUG = branchSlug(ORG, REPO, BRANCH);

async function trigger(headSha, scheduler = defaultScheduler) {
  return scheduler.handleWebhook(ORG, REPO, BRANCH, headSha);
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function testStateA_Idle() {
  console.log("TEST State A: Idle branch → create initial job");
  reset();

  const result = await trigger("sha1");

  assert.equal(result.state, "A");
  assert.equal(result.created, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].metadata.labels["build.fhir.org/slot"], "a");
  assert.equal(jobs[0].metadata.annotations["build.fhir.org/role"], "current");
  assert.ok(
    !jobs[0].spec.template.spec.affinity,
    "Initial job should not have node affinity"
  );
  console.log("  PASS\n");
}

async function testStateB_SinglePending() {
  console.log("TEST State B: Single pending job → patch annotations");
  reset();

  const name = slotName(BKEY, "a", SLUG);
  addJob(name, BKEY, "a", { headSha: "old-sha" });
  addPod(name, { node: null });

  const result = await trigger("new-sha");

  assert.equal(result.state, "B");
  assert.equal(result.created, false);
  assert.equal(result.patched, name);
  assert.equal(jobs.length, 1);
  assert.equal(
    jobs[0].metadata.annotations["build.fhir.org/intent-head-sha"],
    "new-sha"
  );
  console.log("  PASS\n");
}

async function testStateC_SingleRunning() {
  console.log(
    "TEST State C: Single running job → create pinned successor + cancel"
  );
  reset();

  const currentName = slotName(BKEY, "a", SLUG);
  addJob(currentName, BKEY, "a", { headSha: "old-sha" });
  addPod(currentName, { node: "node-X", phase: "Running" });

  const result = await trigger("new-sha");

  assert.equal(result.state, "C");
  assert.equal(result.created, true);
  assert.equal(result.canceled, currentName);
  assert.ok(
    !jobs.find((j) => j.metadata.name === currentName),
    "Old job should be deleted"
  );

  const successor = jobs[0];
  assert.equal(successor.metadata.labels["build.fhir.org/slot"], "b");
  assert.equal(
    successor.metadata.annotations["build.fhir.org/role"],
    "successor"
  );
  assert.equal(
    successor.metadata.annotations["build.fhir.org/pinned-node"],
    "node-X"
  );
  assert.equal(
    successor.metadata.annotations["build.fhir.org/intent-head-sha"],
    "new-sha"
  );

  const terms =
    successor.spec.template.spec.affinity.nodeAffinity
      .requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
  assert.equal(terms[0].matchExpressions[0].values[0], "node-X");
  console.log("  PASS\n");
}

async function testStateD_RunningPlusQueued() {
  console.log(
    "TEST State D: Running + queued → patch successor, ensure current canceled"
  );
  reset();

  const currentName = slotName(BKEY, "a", SLUG);
  const successorName = slotName(BKEY, "b", SLUG);
  addJob(currentName, BKEY, "a", { headSha: "sha-1" });
  addPod(currentName, { node: "node-X", phase: "Running" });
  addJob(successorName, BKEY, "b", { role: "successor", headSha: "sha-2" });
  addPod(successorName, { node: null });

  const result = await trigger("sha-3");

  assert.equal(result.state, "D");
  assert.equal(result.created, false);
  assert.equal(result.patched, successorName);

  const successor = jobs.find((j) => j.metadata.name === successorName);
  assert.equal(
    successor.metadata.annotations["build.fhir.org/intent-head-sha"],
    "sha-3"
  );
  assert.ok(
    !jobs.find((j) => j.metadata.name === currentName),
    "Current should be deleted"
  );
  console.log("  PASS\n");
}

async function testStateE_QueuedOnly() {
  console.log("TEST State E: Queued successor only → patch annotations");
  reset();

  const successorName = slotName(BKEY, "b", SLUG);
  addJob(successorName, BKEY, "b", { role: "successor", headSha: "sha-old" });
  addPod(successorName, { node: null });

  const result = await trigger("sha-new");

  assert.equal(result.state, "E");
  assert.equal(result.created, false);
  assert.equal(result.patched, successorName);
  assert.equal(
    jobs[0].metadata.annotations["build.fhir.org/intent-head-sha"],
    "sha-new"
  );
  console.log("  PASS\n");
}

async function testFloodCollapse() {
  console.log("TEST Flood: 20 rapid webhooks → only 1 create, rest are patches");
  reset();

  await trigger("sha-1");
  assert.equal(jobs.length, 1);

  addPod(jobs[0].metadata.name, { node: "node-Y", phase: "Running" });

  await trigger("sha-2");
  assert.equal(jobs.length, 1);
  const successorName = jobs[0].metadata.name;

  for (let i = 3; i <= 20; i++) {
    const r = await trigger(`sha-${i}`);
    assert.equal(r.state, "E", `Webhook ${i} should hit State E`);
    assert.equal(r.patched, successorName);
  }

  assert.equal(jobs.length, 1, "Still exactly 1 job after 20 webhooks");
  assert.equal(
    jobs[0].metadata.annotations["build.fhir.org/intent-head-sha"],
    "sha-20"
  );

  const creates = calls.filter((c) => c.op === "createJob");
  assert.equal(creates.length, 2, "Only 2 creates total (initial + successor)");
  console.log("  PASS\n");
}

async function testNodeAffinityNotOnInitial() {
  console.log("TEST: Initial job has no node affinity, successor does");
  reset();

  await trigger("sha-1");
  const initial = jobs[0];
  assert.ok(!initial.spec.template.spec.affinity, "Initial: no affinity");

  addPod(initial.metadata.name, { node: "node-Z", phase: "Running" });
  await trigger("sha-2");
  const successor = jobs[0];
  assert.ok(successor.spec.template.spec.affinity, "Successor: has affinity");
  assert.equal(
    successor.spec.template.spec.affinity.nodeAffinity
      .requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms[0]
      .matchExpressions[0].values[0],
    "node-Z"
  );
  console.log("  PASS\n");
}

async function testTerminalJobsIgnored() {
  console.log(
    "TEST: Terminal job in slot a → new job picks slot b to avoid name collision"
  );
  reset();

  addJob(slotName(BKEY, "a", SLUG), BKEY, "a", { status: { succeeded: 1 } });

  const result = await trigger("sha-1");
  assert.equal(result.state, "A");
  const newJob = jobs.find((j) => !isTerminal(j));
  assert.ok(newJob, "New job should exist");
  assert.equal(
    newJob.metadata.labels["build.fhir.org/slot"],
    "b",
    "Should pick slot b since slot a is still occupied by terminal job"
  );
  console.log("  PASS\n");
}

async function testExtrasCleanedUp() {
  console.log("TEST: Extra jobs beyond current+queued are deleted");
  reset();

  addJob(slotName(BKEY, "a", SLUG), BKEY, "a");
  addPod(slotName(BKEY, "a", SLUG), { node: "node-1", phase: "Running" });
  addJob(slotName(BKEY, "b", SLUG), BKEY, "b", { role: "successor" });
  addPod(slotName(BKEY, "b", SLUG), { node: null });
  const extraName = "igbuild-legacy-extra";
  jobs.push({
    metadata: {
      name: extraName,
      creationTimestamp: new Date().toISOString(),
      labels: { "job-group-id": BKEY },
      annotations: {},
    },
    status: {},
  });
  addPod(extraName, { node: null });

  await trigger("sha-x");

  assert.ok(
    !jobs.find((j) => j.metadata.name === extraName),
    "Extra job should be deleted"
  );
  console.log("  PASS\n");
}

async function test409RetryRecoversState() {
  console.log("TEST: 409 on create → retry re-reads state and succeeds");
  reset();

  const currentName = slotName(BKEY, "a", SLUG);
  addJob(currentName, BKEY, "a", { headSha: "old" });
  addPod(currentName, { node: "node-1", phase: "Running" });

  // Override createNamespacedJob to 409 on first call, simulating a concurrent
  // invocation that beat us to creating the successor.
  let createCount = 0;
  const origCreate = k8sBatch.createNamespacedJob;
  k8sBatch.createNamespacedJob = async (opts) => {
    createCount++;
    if (createCount === 1) {
      // Simulate the concurrent invocation's successor appearing
      const successorName = slotName(BKEY, "b", SLUG);
      addJob(successorName, BKEY, "b", {
        role: "successor",
        headSha: "concurrent-sha",
      });
      addPod(successorName, { node: null });
      const err = new Error("already exists");
      err.body = {
        message: `jobs.batch "${opts.body.metadata.name}" already exists`,
      };
      throw err;
    }
    return origCreate.call(k8sBatch, opts);
  };

  const result = await trigger("sha-new");
  k8sBatch.createNamespacedJob = origCreate;

  // On retry, should see State D (running + queued) and patch
  assert.equal(result.state, "D");
  assert.equal(result.created, false);
  console.log("  PASS\n");
}

async function testBothSlotsOccupiedTimesOut() {
  console.log(
    "TEST: Both slots occupied → times out and returns visible error"
  );
  reset();

  addJob(slotName(BKEY, "a", SLUG), BKEY, "a", { status: { succeeded: 1 } });
  addJob(slotName(BKEY, "b", SLUG), BKEY, "b", { status: { succeeded: 1 } });

  // Override delete to be a no-op so names stay occupied
  const origDelete = k8sBatch.deleteNamespacedJob;
  k8sBatch.deleteNamespacedJob = async (opts) => {
    calls.push({ op: "deleteJob", name: opts.name });
    return {};
  };

  // Use a very short timeout so the test doesn't block
  const scheduler = makeScheduler({ opts: { slotPollTimeoutMs: 50, slotPollIntervalMs: 10 } });
  const result = await scheduler.handleWebhook(ORG, REPO, BRANCH, "sha-1");
  k8sBatch.deleteNamespacedJob = origDelete;

  assert.equal(result.ok, false);
  assert.ok(result.reason.includes("Both slots occupied"));
  console.log("  PASS\n");
}

async function testBothSlotsOccupiedFreesUpDuringPoll() {
  console.log(
    "TEST: Both slots occupied → slot frees during poll → succeeds"
  );
  reset();

  addJob(slotName(BKEY, "a", SLUG), BKEY, "a", { status: { succeeded: 1 } });
  addJob(slotName(BKEY, "b", SLUG), BKEY, "b", { status: { succeeded: 1 } });

  // Delete is a no-op initially, but after 3 calls, start actually deleting.
  // This simulates background delete completing after some delay.
  let deleteCallCount = 0;
  const origDelete = k8sBatch.deleteNamespacedJob;
  k8sBatch.deleteNamespacedJob = async (opts) => {
    deleteCallCount++;
    if (deleteCallCount >= 3) {
      return origDelete.call(k8sBatch, opts);
    }
    calls.push({ op: "deleteJob", name: opts.name });
    return {};
  };

  const scheduler = makeScheduler({ opts: { slotPollTimeoutMs: 500, slotPollIntervalMs: 10 } });
  const result = await scheduler.handleWebhook(ORG, REPO, BRANCH, "sha-1");
  k8sBatch.deleteNamespacedJob = origDelete;

  assert.equal(result.ok, true);
  assert.equal(result.state, "A");
  assert.equal(result.created, true);
  console.log("  PASS\n");
}

async function testSlotWaitReReconcilesOnStateChange() {
  console.log(
    "TEST: Slot wait + concurrent job creation → re-reconciles from fresh state"
  );
  reset();

  // Start with both slots occupied by terminal jobs.
  addJob(slotName(BKEY, "a", SLUG), BKEY, "a", { status: { succeeded: 1 } });
  addJob(slotName(BKEY, "b", SLUG), BKEY, "b", { status: { succeeded: 1 } });

  // During the poll wait, simulate a concurrent invocation:
  // 1. Terminal job in slot "a" gets deleted (slot frees up)
  // 2. The concurrent invocation creates a NEW non-terminal job in slot "a"
  //
  // If we naively continued the old reconcile after the wait, we'd try to
  // create in slot "a" (State A) and collide. Instead, the code should
  // re-reconcile from fresh state and see the new job (State B or C).
  let deleteCallCount = 0;
  const origDelete = k8sBatch.deleteNamespacedJob;
  k8sBatch.deleteNamespacedJob = async (opts) => {
    deleteCallCount++;
    if (deleteCallCount >= 3) {
      // Now actually delete
      await origDelete.call(k8sBatch, opts);
      // ...and simulate a concurrent invocation creating a new job in slot "a"
      if (!jobs.some((j) => j.metadata.name === slotName(BKEY, "a", SLUG))) {
        addJob(slotName(BKEY, "a", SLUG), BKEY, "a", { headSha: "concurrent-sha" });
        addPod(slotName(BKEY, "a", SLUG), { node: null, phase: "Pending" });
      }
      return {};
    }
    calls.push({ op: "deleteJob", name: opts.name });
    return {};
  };

  const scheduler = makeScheduler({
    opts: { slotPollTimeoutMs: 500, slotPollIntervalMs: 10 },
  });
  const result = await scheduler.handleWebhook(ORG, REPO, BRANCH, "sha-new");
  k8sBatch.deleteNamespacedJob = origDelete;

  // Should NOT have created a second job in slot "a". Instead, it should
  // re-reconcile and find the concurrent invocation's job (State B: patch it).
  assert.equal(result.ok, true, `Expected ok=true, got: ${JSON.stringify(result)}`);
  assert.equal(result.state, "B",
    "After re-reconcile, should see concurrent job as pending and patch it");
  assert.equal(result.created, false,
    "Should patch existing job, not create a new one");

  // Only one non-terminal job should exist
  const nonTerminal = jobs.filter((j) => !isTerminal(j));
  assert.equal(nonTerminal.length, 1,
    `Should be exactly 1 non-terminal job, got ${nonTerminal.length}`);
  console.log("  PASS\n");
}

async function testStalePinnedSuccessorRecreatedUnpinned() {
  console.log(
    "TEST: Stale pinned successor in State E → delete and recreate unpinned"
  );
  reset();

  // Queued successor pinned to a node, created 5 minutes ago (past threshold)
  const name = slotName(BKEY, "b", SLUG);
  addJob(name, BKEY, "b", {
    role: "successor",
    headSha: "old-sha",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    annotations: { "build.fhir.org/pinned-node": "dead-node" },
  });
  addPod(name, { node: null }); // still unbound

  // Use a short threshold so the test triggers stale detection
  const scheduler = makeScheduler({ opts: { stalePinnedThresholdMs: 60_000 } });
  const result = await scheduler.handleWebhook(ORG, REPO, BRANCH, "new-sha");

  assert.equal(result.ok, true, `Expected ok, got: ${JSON.stringify(result)}`);
  assert.equal(result.state, "E-stale");
  assert.equal(result.created, true);

  // New job should exist without node affinity
  const newJob = jobs.find((j) => !isTerminal(j));
  assert.ok(newJob, "New job should exist");
  assert.ok(
    !newJob.spec?.template?.spec?.affinity,
    "Recreated job should not have node affinity"
  );
  assert.equal(
    newJob.metadata.annotations["build.fhir.org/intent-head-sha"],
    "new-sha"
  );
  console.log("  PASS\n");
}

async function testFreshPinnedSuccessorNotStale() {
  console.log(
    "TEST: Recently-pinned successor in State E → normal patch, not stale"
  );
  reset();

  // Queued successor pinned, but created just 10 seconds ago (not stale)
  const name = slotName(BKEY, "b", SLUG);
  addJob(name, BKEY, "b", {
    role: "successor",
    headSha: "old-sha",
    createdAt: new Date(Date.now() - 10_000).toISOString(),
    annotations: { "build.fhir.org/pinned-node": "some-node" },
  });
  addPod(name, { node: null });

  const result = await trigger("new-sha");

  assert.equal(result.state, "E", "Should be normal State E, not stale");
  assert.equal(result.created, false);
  assert.equal(result.patched, name);
  console.log("  PASS\n");
}

async function testIsolatedSchedulerUsesCustomIdentity() {
  console.log(
    "TEST: Isolated scheduler uses custom branch scope, label, and name prefix"
  );
  reset();

  const prodName = slotName(BKEY, "a", SLUG);
  addJob(prodName, BKEY, "a");
  addPod(prodName, { node: null, phase: "Pending" });

  const isolatedManagedBy = "ig-trigger-testing";
  const isolatedPrefix = "igbuildtest";
  const isolatedScope = "testing";
  const isolatedBranchKey = computeBranchKey(ORG, REPO, BRANCH, isolatedScope);
  const isolatedScheduler = makeScheduler({
    managedByLabel: isolatedManagedBy,
    jobNamePrefix: isolatedPrefix,
    branchKeyScope: isolatedScope,
  });

  const result = await trigger("sha-testing", isolatedScheduler);

  assert.equal(result.ok, true);
  assert.equal(result.state, "A");
  assert.equal(jobs.length, 2, "Isolated scheduler should not collide with prod-like job");

  const isolatedJob = jobs.find(
    (job) => job.metadata.labels["build.fhir.org/managed-by"] === isolatedManagedBy
  );
  assert.ok(isolatedJob, "Expected isolated job to be created");
  assert.equal(
    isolatedJob.metadata.labels["build.fhir.org/branch-key"],
    isolatedBranchKey
  );
  assert.ok(
    isolatedJob.metadata.name.startsWith(`${isolatedPrefix}-`),
    `Expected job name to start with ${isolatedPrefix}-`
  );
  assert.ok(
    calls.some(
      (call) =>
        call.op === "listJobs" &&
        call.labelSelector.includes(`build.fhir.org/managed-by=${isolatedManagedBy}`)
    ),
    "Expected isolated managed-by label selector to be used"
  );
  console.log("  PASS\n");
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log("=== Branch-Head Scheduling Tests ===\n");
await testStateA_Idle();
await testStateB_SinglePending();
await testStateC_SingleRunning();
await testStateD_RunningPlusQueued();
await testStateE_QueuedOnly();
await testFloodCollapse();
await testNodeAffinityNotOnInitial();
await testTerminalJobsIgnored();
await testExtrasCleanedUp();
await test409RetryRecoversState();
await testBothSlotsOccupiedTimesOut();
await testBothSlotsOccupiedFreesUpDuringPoll();
await testSlotWaitReReconcilesOnStateChange();
await testStalePinnedSuccessorRecreatedUnpinned();
await testFreshPinnedSuccessorNotStale();
await testIsolatedSchedulerUsesCustomIdentity();
console.log("All tests passed.");
