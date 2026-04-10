// @ts-check

/** @import { BatchV1Api, CoreV1Api, CoreV1Event, V1Job, V1Pod } from "@kubernetes/client-node" */

const NAMESPACE = "fhir";

/**
 * @typedef {{ job: V1Job, node: string | null, slot: string | null, role: string | null }} EnrichedJob
 */

/**
 * @typedef {{
 *   stalePinnedThresholdMs?: number,
 * }} SweepOpts
 */

/**
 * @typedef {{
 *   candidate: boolean,
 *   reason: string,
 *   evidence: string[],
 *   pinnedNode: string | null,
 *   pinnedNodeExists: boolean | null,
 *   podScheduled: string | null,
 *   unhelpable: boolean,
 *   nodeAffinityMismatch: boolean,
 *   ageMs: number,
 * }} SweepVerdict
 */

/** @param {V1Pod | null} pod */
function getPodScheduledCondition(pod) {
  return (
    pod?.status?.conditions?.find((c) => c.type === "PodScheduled")?.status ?? null
  );
}

/** @param {V1Pod | null} pod */
function isUnhelpable(pod) {
  return (
    pod?.metadata?.annotations?.[
      "cloud.google.com/cluster_autoscaler_unhelpable_until"
    ] === "Inf"
  );
}

/** @param {CoreV1Event[]} events */
function hasNodeAffinityMismatch(events) {
  return events.some((event) => {
    const message = event.message ?? "";
    return (
      event.reason === "FailedScheduling" &&
      message.includes("didn't match Pod's node affinity/selector")
    );
  });
}

/**
 * Pure classifier for "is this queued successor safely recoverable as a stale pin?"
 *
 * @param {{
 *   current: EnrichedJob | null,
 *   queued: EnrichedJob | null,
 *   pod: V1Pod | null,
 *   events?: CoreV1Event[],
 *   pinnedNodeExists: boolean | null,
 *   stalePinnedThresholdMs?: number,
 *   now?: number,
 * }} input
 * @returns {SweepVerdict}
 */
export function classifyStalePinnedSuccessor(input) {
  const {
    current,
    queued,
    pod,
    events = [],
    pinnedNodeExists,
    stalePinnedThresholdMs = 3 * 60_000,
    now = Date.now(),
  } = input;

  /** @type {string[]} */
  const evidence = [];

  if (!queued) {
    return {
      candidate: false,
      reason: "No queued successor",
      evidence,
      pinnedNode: null,
      pinnedNodeExists: null,
      podScheduled: null,
      unhelpable: false,
      nodeAffinityMismatch: false,
      ageMs: 0,
    };
  }

  const queuedJob = queued.job;
  const role = queuedJob.metadata?.annotations?.["build.fhir.org/role"] ?? null;
  const pinnedNode =
    queuedJob.metadata?.annotations?.["build.fhir.org/pinned-node"] ?? null;
  const createdAt = new Date(queuedJob.metadata?.creationTimestamp ?? 0).getTime();
  const ageMs = Math.max(0, now - createdAt);
  const podScheduled = getPodScheduledCondition(pod);
  const unhelpable = isUnhelpable(pod);
  const nodeAffinityMismatch = hasNodeAffinityMismatch(events);

  if (current) {
    return {
      candidate: false,
      reason: "Current job still exists",
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (role !== "successor") {
    return {
      candidate: false,
      reason: "Queued job is not a successor",
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (!pod) {
    return {
      candidate: false,
      reason: "Queued successor has no pod",
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (pod.status?.phase !== "Pending") {
    return {
      candidate: false,
      reason: `Pod phase is ${pod.status?.phase ?? "unknown"}, not Pending`,
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (pod.spec?.nodeName) {
    return {
      candidate: false,
      reason: `Pod is already bound to ${pod.spec.nodeName}`,
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (podScheduled !== "False") {
    return {
      candidate: false,
      reason: `PodScheduled is ${podScheduled ?? "missing"}, not False`,
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (!pinnedNode) {
    return {
      candidate: false,
      reason: "Queued successor is not pinned",
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (ageMs <= stalePinnedThresholdMs) {
    return {
      candidate: false,
      reason: `Queued successor age ${ageMs}ms is below threshold ${stalePinnedThresholdMs}ms`,
      evidence,
      pinnedNode,
      pinnedNodeExists,
      podScheduled,
      unhelpable,
      nodeAffinityMismatch,
      ageMs,
    };
  }

  if (pinnedNodeExists === false) {
    evidence.push(`Pinned node ${pinnedNode} no longer exists`);
  }
  if (nodeAffinityMismatch) {
    evidence.push("Scheduler events show node affinity mismatch");
  }
  if (unhelpable) {
    evidence.push("Cluster autoscaler marked pod unhelpable");
  }

  const pinIsBlocker = pinnedNodeExists === false || nodeAffinityMismatch;
  return {
    candidate: pinIsBlocker,
    reason: pinIsBlocker
      ? "Queued successor is stale-pinned and safe to recreate unpinned"
      : "Pending state is not yet clearly attributable to a dead/stale pin",
    evidence,
    pinnedNode,
    pinnedNodeExists,
    podScheduled,
    unhelpable,
    nodeAffinityMismatch,
    ageMs,
  };
}

/**
 * @param {{
 *   scheduler: ReturnType<import("./scheduling.js").createScheduler>,
 *   k8sBatch: BatchV1Api,
 *   k8sCore: CoreV1Api,
 *   opts?: SweepOpts,
 * }} deps
 */
export function createSweepHandler({ scheduler, k8sBatch, k8sCore, opts = {} }) {
  const STALE_PINNED_THRESHOLD_MS = opts.stalePinnedThresholdMs ?? 3 * 60_000;

  let cachedNodeNames = /** @type {Set<string> | null} */ (null);

  async function getNodeNames() {
    if (cachedNodeNames) return cachedNodeNames;
    const result = await k8sCore.listNode();
    cachedNodeNames = new Set(
      (result.items ?? [])
        .map((n) => n.metadata?.name)
        .filter((name) => typeof name === "string")
    );
    return cachedNodeNames;
  }

  /** @param {string} jobName */
  async function getJobPod(jobName) {
    const result = await k8sCore.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `job-name=${jobName}`,
    });
    return result.items?.[0] ?? null;
  }

  /** @param {string} podName */
  async function getPodEvents(podName) {
    const result = await k8sCore.listNamespacedEvent({
      namespace: NAMESPACE,
      fieldSelector: `involvedObject.kind=Pod,involvedObject.name=${podName}`,
    });
    return result.items ?? [];
  }

  async function listManagedBranchKeys() {
    const result = await k8sBatch.listNamespacedJob({
      namespace: NAMESPACE,
      labelSelector: "build.fhir.org/managed-by=ig-trigger",
    });
    return /** @type {string[]} */ (Array.from(
      new Set(
        (result.items ?? [])
          .map((job) => job.metadata?.labels?.["build.fhir.org/branch-key"] ?? null)
          .filter((key) => typeof key === "string")
      )
    ));
  }

  /**
   * @param {{ apply: boolean, branchKey?: string | null, jobName?: string | null }} args
   */
  async function runSweep({ apply, branchKey = null, jobName = null }) {
    const branchKeys = branchKey ? [branchKey] : await listManagedBranchKeys();
    /** @type {any[]} */
    const scanned = [];
    /** @type {any[]} */
    const recovered = [];

    for (const key of branchKeys) {
      const state = await scheduler.reduceBranchState(key);
      if (!state.queued) continue;

      const queuedJob = state.queued.job;
      const queuedName = queuedJob.metadata?.name ?? "";
      if (jobName && queuedName !== jobName) continue;

      const pod = await getJobPod(queuedName);
      const pinnedNode =
        queuedJob.metadata?.annotations?.["build.fhir.org/pinned-node"] ?? null;
      const nodeNames = pinnedNode ? await getNodeNames() : null;
      const pinnedNodeExists = pinnedNode ? nodeNames?.has(pinnedNode) ?? false : null;
      const events = pod?.metadata?.name ? await getPodEvents(pod.metadata.name) : [];

      const verdict = classifyStalePinnedSuccessor({
        current: state.current,
        queued: state.queued,
        pod,
        events,
        pinnedNodeExists,
        stalePinnedThresholdMs: STALE_PINNED_THRESHOLD_MS,
      });

      scanned.push({
        branchKey: key,
        queuedJob: queuedName,
        currentJob: state.current?.job.metadata?.name ?? null,
        podName: pod?.metadata?.name ?? null,
        pinnedNode: verdict.pinnedNode,
        pinnedNodeExists: verdict.pinnedNodeExists,
        podScheduled: verdict.podScheduled,
        unhelpable: verdict.unhelpable,
        nodeAffinityMismatch: verdict.nodeAffinityMismatch,
        ageMs: verdict.ageMs,
        candidate: verdict.candidate,
        reason: verdict.reason,
        evidence: verdict.evidence,
      });

      if (!apply || !verdict.candidate) continue;

      const annotations = queuedJob.metadata?.annotations ?? {};
      const org = annotations["build.fhir.org/org"];
      const repo = annotations["build.fhir.org/repo"];
      const branch = annotations["build.fhir.org/branch"];
      const headSha = annotations["build.fhir.org/intent-head-sha"];

      if (!org || !repo || !branch || !headSha) {
        recovered.push({
          branchKey: key,
          queuedJob: queuedName,
          recovered: false,
          reason: "Missing org/repo/branch/head intent annotations",
        });
        continue;
      }

      console.log(
        `Sweep recovery: deleting stale pinned successor ${queuedName} for ${org}/${repo}@${branch} pinned to ${verdict.pinnedNode}`
      );
      await scheduler.deleteJob(queuedName);
      const recreate = await scheduler.handleWebhook(org, repo, branch, headSha);
      recovered.push({
        branchKey: key,
        queuedJob: queuedName,
        recovered: Boolean(recreate.ok),
        recreate,
      });
    }

    return {
      ok: true,
      apply,
      stalePinnedThresholdMs: STALE_PINNED_THRESHOLD_MS,
      scannedCount: scanned.length,
      candidateCount: scanned.filter((s) => s.candidate).length,
      recoveredCount: recovered.filter((r) => r.recovered).length,
      scanned,
      recovered,
    };
  }

  return async function sweepHandler(
    /** @type {any} */ req,
    /** @type {any} */ res
  ) {
    if (req.method === "OPTIONS") {
      return res.status(200).json({});
    }
    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ ok: false, reason: "Use GET or POST" });
    }

    const apply = req.method === "POST" && (
      req.query?.apply === "1" ||
      req.query?.apply === "true" ||
      req.body?.apply === true ||
      req.body?.apply === "1" ||
      req.body?.apply === "true"
    );
    const branchKey =
      typeof req.query?.branchKey === "string" ? req.query.branchKey : null;
    const jobName =
      typeof req.query?.jobName === "string" ? req.query.jobName : null;

    try {
      const result = await runSweep({ apply, branchKey, jobName });
      return res.status(200).json(result);
    } catch (e) {
      console.error(e);
      return res.status(500).json({
        ok: false,
        reason: /** @type {any} */ (e)?.message ?? "Sweep failed",
      });
    }
  };
}
