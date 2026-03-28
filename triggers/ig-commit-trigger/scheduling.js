// @ts-check

import crypto from "crypto";

/** @import { BatchV1Api, CoreV1Api, V1Job, V1JobList, V1PodList } from "@kubernetes/client-node" */

const NAMESPACE = "fhir";

// --- Helpers ---

/** @param {string} org @param {string} repo @param {string} branch */
export function computeBranchKey(org, repo, branch) {
  return crypto
    .createHash("sha256")
    .update(`${org}-${repo}-${branch}`, "utf8")
    .digest("hex")
    .slice(0, 63);
}

/**
 * Normalized, truncated human-readable slug for use in job names.
 * @param {string} org @param {string} repo @param {string} branch
 */
export function branchSlug(org, repo, branch) {
  return `${org}-${repo}-${branch}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Stable short hash of the full org/repo/branch identity.
 * Uniqueness guard in case different branches normalize to the same slug.
 * @param {string} branchKey
 */
export function shortHash(branchKey) {
  return branchKey.slice(0, 8);
}

/**
 * Job name for a given branch + slot.
 * Format: igbuild-<slug>-<shortHash>-<slot>  (max 63 chars)
 * @param {string} branchKey
 * @param {string} slot
 * @param {string} [slug]
 */
export function slotName(branchKey, slot, slug) {
  const s = slug ?? branchKey.slice(0, 40);
  const h = shortHash(branchKey);
  return `igbuild-${s}-${h}-${slot}`.slice(0, 63);
}

/** @param {string} slot */
export function otherSlot(slot) {
  return slot === "a" ? "b" : "a";
}

/** @param {V1Job} job */
function isTerminal(job) {
  if ((job.status?.succeeded ?? 0) > 0) return true;
  return (job.status?.conditions ?? []).some(
    (c) => c.type === "Failed" && c.status === "True"
  );
}

/**
 * @typedef {{
 *   maxReconcileAttempts?: number,
 *   slotPollIntervalMs?: number,
 *   slotPollTimeoutMs?: number,
 *   stalePinnedThresholdMs?: number,
 * }} SchedulerOpts
 */

/**
 * @typedef {{ job: V1Job, node: string | null, slot: string | null, role: string | null }} EnrichedJob
 */

/**
 * @typedef {{
 *   current: EnrichedJob | null,
 *   queued: EnrichedJob | null,
 *   extras: EnrichedJob[],
 *   terminal: V1Job[],
 *   occupiedNames: Set<string>,
 * }} BranchState
 */

/**
 * @param {{
 *   k8sBatch: BatchV1Api,
 *   k8sCore: CoreV1Api,
 *   jobSource: object,
 *   opts?: SchedulerOpts,
 *   patchOptions?: object,
 * }} deps
 */
export function createScheduler({ k8sBatch, k8sCore, jobSource, opts = {}, patchOptions }) {
  const MAX_RECONCILE_ATTEMPTS = opts.maxReconcileAttempts ?? 3;
  const SLOT_POLL_INTERVAL_MS = opts.slotPollIntervalMs ?? 1000;
  const SLOT_POLL_TIMEOUT_MS = opts.slotPollTimeoutMs ?? 15_000;
  const STALE_PINNED_THRESHOLD_MS = opts.stalePinnedThresholdMs ?? 3 * 60_000;

  // --- K8s Operations ---

  /** @param {string} jobName */
  async function getJobNode(jobName) {
    /** @type {V1PodList} */
    const podList = await k8sCore.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `job-name=${jobName}`,
    });
    const pods = podList.items ?? [];
    const bound = pods.find((p) => p.spec?.nodeName);
    return bound?.spec?.nodeName ?? null;
  }

  /**
   * @param {string} jobName
   * @param {Record<string, string>} annotations
   */
  async function patchAnnotations(jobName, annotations) {
    await k8sBatch.patchNamespacedJob(
      {
        name: jobName,
        namespace: NAMESPACE,
        body: { metadata: { annotations } },
      },
      patchOptions
    );
  }

  /** @param {string} name */
  async function deleteJob(name) {
    try {
      await k8sBatch.deleteNamespacedJob({
        name,
        namespace: NAMESPACE,
        gracePeriodSeconds: 0,
        propagationPolicy: "Background",
      });
    } catch (e) {
      const code = /** @type {any} */ (e)?.code ?? /** @type {any} */ (e)?.body?.code;
      if (code !== 404) throw e;
    }
  }

  // --- Branch State Reduction ---

  /** @param {string} branchKey @returns {Promise<BranchState>} */
  async function reduceBranchState(branchKey) {
    const [newResult, legacyResult] = await Promise.all([
      /** @type {Promise<V1JobList>} */ (k8sBatch.listNamespacedJob({
        namespace: NAMESPACE,
        labelSelector: `build.fhir.org/managed-by=ig-trigger,build.fhir.org/branch-key=${branchKey}`,
      })),
      /** @type {Promise<V1JobList>} */ (k8sBatch.listNamespacedJob({
        namespace: NAMESPACE,
        labelSelector: `job-group-id=${branchKey}`,
      })),
    ]);

    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {V1Job[]} */
    const allJobs = [];
    /** @type {V1Job[]} */
    const terminal = [];
    for (const job of [...(newResult.items ?? []), ...(legacyResult.items ?? [])]) {
      const name = job.metadata?.name ?? "";
      if (seen.has(name)) continue;
      seen.add(name);
      if (job.metadata?.deletionTimestamp) continue;
      if (isTerminal(job)) {
        terminal.push(job);
      } else {
        allJobs.push(job);
      }
    }

    const enriched = await Promise.all(
      allJobs.map(async (job) => {
        const name = job.metadata?.name ?? "";
        const node = await getJobNode(name);
        return /** @type {EnrichedJob} */ ({
          job,
          node,
          slot: job.metadata?.labels?.["build.fhir.org/slot"] ?? null,
          role: job.metadata?.annotations?.["build.fhir.org/role"] ?? null,
        });
      })
    );

    enriched.sort((a, b) => {
      if (a.node && !b.node) return -1;
      if (!a.node && b.node) return 1;
      const aTime = new Date(a.job.metadata?.creationTimestamp ?? 0).getTime();
      const bTime = new Date(b.job.metadata?.creationTimestamp ?? 0).getTime();
      return aTime - bTime;
    });

    /** @type {EnrichedJob | null} */
    let current = null;
    /** @type {EnrichedJob | null} */
    let queued = null;
    /** @type {EnrichedJob[]} */
    const extras = [];

    for (const entry of enriched) {
      if (entry.role === "successor" && !entry.node) {
        if (!queued) { queued = entry; continue; }
      }
      if (!current) {
        current = entry;
      } else if (!queued) {
        queued = entry;
      } else {
        extras.push(entry);
      }
    }

    /** @type {Set<string>} */
    const occupiedNames = new Set();
    for (const job of [...(newResult.items ?? []), ...(legacyResult.items ?? [])]) {
      if (job.metadata?.name) occupiedNames.add(job.metadata.name);
    }

    return { current, queued, extras, terminal, occupiedNames };
  }

  // --- Job Construction ---

  /**
   * @param {string} branchKey
   * @param {string} slot
   * @param {string} org
   * @param {string} repo
   * @param {string} branch
   * @param {string} headSha
   * @param {{ role?: string, pinnedNode?: string }} [buildOpts]
   * @returns {V1Job}
   */
  function buildJob(branchKey, slot, org, repo, branch, headSha, buildOpts = {}) {
    /** @type {any} */
    const job = JSON.parse(JSON.stringify(jobSource));

    job.metadata.name = slotName(branchKey, slot, branchSlug(org, repo, branch));
    job.metadata.labels = {
      "build.fhir.org/managed-by": "ig-trigger",
      "build.fhir.org/branch-key": branchKey,
      "build.fhir.org/slot": slot,
      "job-group-id": branchKey,
    };
    job.metadata.annotations = {
      "build.fhir.org/org": org,
      "build.fhir.org/repo": repo,
      "build.fhir.org/branch": branch,
      "build.fhir.org/role": buildOpts.role ?? "current",
      "build.fhir.org/intent-head-sha": headSha,
      "build.fhir.org/source-received-at": new Date().toISOString(),
    };
    if (buildOpts.pinnedNode) {
      job.metadata.annotations["build.fhir.org/pinned-node"] = buildOpts.pinnedNode;
    }

    for (const container of job.spec.template.spec.containers) {
      container.env = container.env.concat([
        { name: "IG_ORG", value: org },
        { name: "IG_REPO", value: repo },
        { name: "IG_BRANCH", value: branch },
      ]);
    }

    if (buildOpts.pinnedNode) {
      job.spec.template.spec.affinity = {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  {
                    key: "kubernetes.io/hostname",
                    operator: "In",
                    values: [buildOpts.pinnedNode],
                  },
                ],
              },
            ],
          },
        },
      };
    }

    return /** @type {V1Job} */ (job);
  }

  // --- Slot Polling ---

  /**
   * Actively wait for a free slot. On each iteration, re-read state and
   * re-issue deletes for terminal jobs still blocking a slot name.
   * @param {string} branchKey
   * @param {string} slug
   * @returns {Promise<string | null>}
   */
  async function waitForFreeSlot(branchKey, slug) {
    const deadline = Date.now() + SLOT_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SLOT_POLL_INTERVAL_MS));
      const { terminal: staleTerminal, occupiedNames } =
        await reduceBranchState(branchKey);
      for (const job of staleTerminal) {
        if (job.metadata?.name) await deleteJob(job.metadata.name);
      }
      for (const s of ["a", "b"]) {
        if (!occupiedNames.has(slotName(branchKey, s, slug))) return s;
      }
    }
    return null;
  }

  // --- Reconciliation ---

  /**
   * @param {string} branchKey
   * @param {string} org
   * @param {string} repo
   * @param {string} branch
   * @param {string} headSha
   */
  async function reconcile(branchKey, org, repo, branch, headSha) {
    const slug = branchSlug(org, repo, branch);
    const { current, queued, extras, terminal, occupiedNames } =
      await reduceBranchState(branchKey);

    for (const entry of extras) {
      const name = entry.job.metadata?.name;
      if (name) {
        console.log(`Cleanup extra: ${name}`);
        await deleteJob(name);
      }
    }
    for (const job of terminal) {
      const name = job.metadata?.name;
      if (name) {
        console.log(`Cleanup terminal: ${name}`);
        await deleteJob(name);
      }
    }

    /** @type {Record<string, string>} */
    const intentAnnotations = {
      "build.fhir.org/intent-head-sha": headSha,
      "build.fhir.org/source-received-at": new Date().toISOString(),
    };

    /** @param {string} preferred */
    function findFreeSlot(preferred) {
      if (!occupiedNames.has(slotName(branchKey, preferred, slug))) return preferred;
      const alt = otherSlot(preferred);
      if (!occupiedNames.has(slotName(branchKey, alt, slug))) return alt;
      return null;
    }

    // State A: Idle
    if (!current && !queued) {
      let slot = findFreeSlot("a");
      if (!slot) {
        console.log("Both slots occupied, polling for release...");
        slot = await waitForFreeSlot(branchKey, slug);
        if (!slot) {
          return { ok: false, reason: "Both slots occupied and timed out waiting for release" };
        }
        return { ok: false, retry: true, reason: "Slot freed after wait; re-reconciling from fresh state" };
      }
      console.log(`State A (idle): creating initial job in slot ${slot}`);
      const job = buildJob(branchKey, slot, org, repo, branch, headSha);
      await k8sBatch.createNamespacedJob({ namespace: NAMESPACE, body: job });
      return { ok: true, created: true, state: "A", jobId: job.metadata?.name, org, repo, branch };
    }

    // State B: Single pending
    if (current && !current.node && !queued) {
      const name = current.job.metadata?.name ?? "";
      console.log(`State B (pending): patching ${name}`);
      await patchAnnotations(name, intentAnnotations);
      return { ok: true, created: false, state: "B", patched: name, org, repo, branch };
    }

    // State C: Single running — create successor, cancel current
    if (current && current.node && !queued) {
      const preferred = current.slot ? otherSlot(current.slot) : "b";
      let successorSlot = findFreeSlot(preferred);
      if (!successorSlot) {
        console.log("Both slots occupied, polling for release...");
        successorSlot = await waitForFreeSlot(branchKey, slug);
        if (!successorSlot) {
          return { ok: false, reason: "Both slots occupied and timed out waiting for release" };
        }
        return { ok: false, retry: true, reason: "Slot freed after wait; re-reconciling from fresh state" };
      }
      const currentName = current.job.metadata?.name ?? "";
      console.log(
        `State C (running): successor ${slotName(branchKey, successorSlot, slug)} pinned to ${current.node}, cancel ${currentName}`
      );
      const job = buildJob(branchKey, successorSlot, org, repo, branch, headSha, {
        role: "successor",
        pinnedNode: current.node,
      });
      await k8sBatch.createNamespacedJob({ namespace: NAMESPACE, body: job });
      await deleteJob(currentName);
      return { ok: true, created: true, state: "C", jobId: job.metadata?.name, canceled: currentName, org, repo, branch };
    }

    // State D: Running + queued successor
    if (current && queued) {
      const queuedName = queued.job.metadata?.name ?? "";
      console.log(`State D (running+queued): patching ${queuedName}`);
      await patchAnnotations(queuedName, intentAnnotations);
      const currentName = current.job.metadata?.name;
      if (currentName && !current.job.metadata?.deletionTimestamp) {
        await deleteJob(currentName);
      }
      return { ok: true, created: false, state: "D", patched: queuedName, org, repo, branch };
    }

    // State E: Queued successor only
    if (!current && queued) {
      const queuedName = queued.job.metadata?.name ?? "";
      const pinnedNode = queued.job.metadata?.annotations?.["build.fhir.org/pinned-node"];
      const createdAt = new Date(queued.job.metadata?.creationTimestamp ?? 0).getTime();
      const isStalePinned = pinnedNode && !queued.node && (Date.now() - createdAt > STALE_PINNED_THRESHOLD_MS);

      if (isStalePinned) {
        // Pinned node likely disappeared. Delete and recreate unpinned.
        console.log(`State E (stale pinned): deleting ${queuedName} pinned to ${pinnedNode}, recreating unpinned`);
        await deleteJob(queuedName);
        const freeSlot = findFreeSlot("a");
        if (!freeSlot) {
          // The name we just deleted may not be free yet. Signal retry.
          return { ok: false, retry: true, reason: "Deleted stale successor; re-reconciling" };
        }
        const job = buildJob(branchKey, freeSlot, org, repo, branch, headSha);
        await k8sBatch.createNamespacedJob({ namespace: NAMESPACE, body: job });
        return { ok: true, created: true, state: "E-stale", jobId: job.metadata?.name, org, repo, branch };
      }

      console.log(`State E (queued only): patching ${queuedName}`);
      await patchAnnotations(queuedName, intentAnnotations);
      return { ok: true, created: false, state: "E", patched: queuedName, org, repo, branch };
    }

    return { ok: false, reason: "Unexpected branch state" };
  }

  // --- Top-level trigger with retry ---

  /**
   * @param {string} org
   * @param {string} repo
   * @param {string} branch
   * @param {string} headSha
   */
  async function handleWebhook(org, repo, branch, headSha) {
    const branchKey = computeBranchKey(org, repo, branch);
    console.log(
      `Webhook: ${org}/${repo}@${branch} head=${headSha.slice(0, 8)} key=${branchKey.slice(0, 12)}`
    );

    for (let attempt = 1; attempt <= MAX_RECONCILE_ATTEMPTS; attempt++) {
      try {
        const result = await reconcile(branchKey, org, repo, branch, headSha);
        if (result.retry) {
          console.log(`Retry after slot wait on attempt ${attempt}/${MAX_RECONCILE_ATTEMPTS}`);
          if (attempt === MAX_RECONCILE_ATTEMPTS) {
            return { ok: false, reason: "Could not reconcile after repeated retries" };
          }
          continue;
        }
        return result;
      } catch (e) {
        const msg = /** @type {any} */ (e)?.body?.message ?? /** @type {any} */ (e)?.message ?? "";
        if (typeof msg === "string" && msg.includes("already exists")) {
          console.log(`409 on attempt ${attempt}/${MAX_RECONCILE_ATTEMPTS} — re-reading state`);
          if (attempt === MAX_RECONCILE_ATTEMPTS) {
            return { ok: false, reason: "Could not reconcile after repeated conflicts" };
          }
          continue;
        }
        throw e;
      }
    }
    return { ok: false, reason: "Exhausted reconcile attempts" };
  }

  return {
    reduceBranchState,
    reconcile,
    handleWebhook,
    waitForFreeSlot,
    buildJob,
    deleteJob,
    patchAnnotations,
  };
}
