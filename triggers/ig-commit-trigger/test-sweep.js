import { strict as assert } from "node:assert";
import { classifyStalePinnedSuccessor } from "./sweep.js";

function makeQueuedJob(overrides = {}) {
  return {
    job: {
      metadata: {
        name: "igbuild-test-a",
        creationTimestamp: "2026-04-09T16:15:11Z",
        annotations: {
          "build.fhir.org/role": "successor",
          "build.fhir.org/pinned-node": "node-dead",
          ...overrides.annotations,
        },
      },
    },
    node: overrides.node ?? null,
    slot: "b",
    role: overrides.role ?? "successor",
  };
}

function makePendingPod(overrides = {}) {
  return {
    metadata: { annotations: { ...overrides.annotations } },
    spec: { nodeName: overrides.nodeName ?? null },
    status: {
      phase: overrides.phase ?? "Pending",
      conditions: [
        { type: "PodScheduled", status: overrides.podScheduled ?? "False" },
      ],
    },
  };
}

async function testDeadPinnedNodeIsCandidate() {
  console.log("TEST sweep classifier: dead pinned node + affinity mismatch is a candidate");

  const verdict = classifyStalePinnedSuccessor({
    current: null,
    queued: makeQueuedJob(),
    pod: makePendingPod({
      annotations: {
        "cloud.google.com/cluster_autoscaler_unhelpable_until": "Inf",
      },
    }),
    events: [
      {
        reason: "FailedScheduling",
        message: "0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector.",
      },
    ],
    pinnedNodeExists: false,
    stalePinnedThresholdMs: 3 * 60_000,
    now: new Date("2026-04-09T23:30:00Z").getTime(),
  });

  assert.equal(verdict.candidate, true);
  assert.equal(verdict.unhelpable, true);
  assert.equal(verdict.nodeAffinityMismatch, true);
  console.log("  PASS\n");
}

async function testGeneralPendingIsNotCandidate() {
  console.log("TEST sweep classifier: general pending initial backlog is not a candidate");

  const verdict = classifyStalePinnedSuccessor({
    current: null,
    queued: makeQueuedJob({
      annotations: {
        "build.fhir.org/role": "successor",
      },
    }),
    pod: makePendingPod(),
    events: [
      {
        reason: "FailedScheduling",
        message: "0/3 nodes are available: 3 Insufficient memory.",
      },
    ],
    pinnedNodeExists: true,
    stalePinnedThresholdMs: 3 * 60_000,
    now: new Date("2026-04-09T16:25:00Z").getTime(),
  });

  assert.equal(verdict.candidate, false);
  assert.match(verdict.reason, /not yet clearly attributable/);
  console.log("  PASS\n");
}

async function testCurrentStillRunningPreventsRecovery() {
  console.log("TEST sweep classifier: current job still alive blocks recovery");

  const verdict = classifyStalePinnedSuccessor({
    current: makeQueuedJob({
      role: "current",
      annotations: { "build.fhir.org/role": "current" },
      node: "node-live",
    }),
    queued: makeQueuedJob(),
    pod: makePendingPod(),
    events: [
      {
        reason: "FailedScheduling",
        message: "0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector.",
      },
    ],
    pinnedNodeExists: false,
    stalePinnedThresholdMs: 3 * 60_000,
    now: new Date("2026-04-09T23:30:00Z").getTime(),
  });

  assert.equal(verdict.candidate, false);
  assert.match(verdict.reason, /Current job still exists/);
  console.log("  PASS\n");
}

await testDeadPinnedNodeIsCandidate();
await testGeneralPendingIsNotCandidate();
await testCurrentStillRunningPreventsRecovery();

console.log("Sweep tests passed.");
