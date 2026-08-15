// @ts-check

import functions from "@google-cloud/functions-framework";
import * as k8s from "@kubernetes/client-node";
import jobSource from "./job.json" with { type: "json" };
import { createScheduler } from "./scheduling.js";
import { createSweepHandler } from "./sweep.js";
import { detectPlatform, parseGitlabPayload, parseGithubPayload } from "./platform.js";

/** @import { BuildRequest } from "./platform.js" */

const kc = new k8s.KubeConfig();
kc.loadFromFile("sa.kubeconfig");

const k8sBatch = kc.makeApiClient(k8s.BatchV1Api);
const k8sCore = kc.makeApiClient(k8s.CoreV1Api);

const MANAGED_BY_LABEL = process.env.IG_TRIGGER_MANAGED_BY ?? "ig-trigger";
const JOB_NAME_PREFIX = process.env.IG_TRIGGER_JOB_PREFIX ?? "igbuild";
const BRANCH_KEY_SCOPE = process.env.IG_TRIGGER_BRANCH_KEY_SCOPE ?? "";
const BUILD_IMAGE = process.env.IG_BUILD_IMAGE ?? "";

function buildJobSource() {
  /** @type {any} */
  const resolvedJobSource = JSON.parse(JSON.stringify(jobSource));
  if (!BUILD_IMAGE) return resolvedJobSource;
  for (const container of resolvedJobSource.spec.template.spec.containers) {
    container.image = BUILD_IMAGE;
  }
  return resolvedJobSource;
}

const scheduler = createScheduler({
  k8sBatch,
  k8sCore,
  jobSource: buildJobSource(),
  managedByLabel: MANAGED_BY_LABEL,
  jobNamePrefix: JOB_NAME_PREFIX,
  branchKeyScope: BRANCH_KEY_SCOPE,
  patchOptions: k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.StrategicMergePatch),
});
const sweepHandler = createSweepHandler({
  scheduler,
  k8sBatch,
  k8sCore,
  managedByLabel: MANAGED_BY_LABEL,
});

// --- ig.ini and HEAD resolution ---

/**
 * @param {BuildRequest} buildReq
 */
async function hasIgIni(buildReq) {
  const { platform, baseUrl, org, repo, branch } = buildReq;
  let url;
  if (platform === "gitlab") {
    // org is "gitlab.com/namespace" — extract just the namespace path
    const pathWithNamespace = `${org.replace(/^[^/]+\//, "")}/${repo}`;
    url = `${baseUrl}/${pathWithNamespace}/-/raw/${encodeURIComponent(branch)}/ig.ini`;
  } else {
    url = `https://raw.githubusercontent.com/${org}/${repo}/${encodeURIComponent(branch)}/ig.ini`;
  }
  const resp = await fetch(url);
  return resp.status === 200;
}

/**
 * @param {BuildRequest} buildReq
 */
async function resolveHead(buildReq) {
  const { platform, baseUrl, org, repo, branch } = buildReq;

  if (platform === "gitlab") {
    // org is "gitlab.com/namespace" — extract the namespace path for the API
    const pathWithNamespace = `${org.replace(/^[^/]+\//, "")}/${repo}`;
    const encodedPath = encodeURIComponent(pathWithNamespace);
    const url = `${baseUrl}/api/v4/projects/${encodedPath}/repository/commits/${encodeURIComponent(branch)}`;
    const resp = await fetch(url);
    if (resp.status !== 200) return null;
    const data = await resp.json();
    return /** @type {string | null} */ (data.id ?? null);
  }

  // GitHub
  const resp = await fetch(
    `https://api.github.com/repos/${org}/${repo}/commits/${encodeURIComponent(branch)}`,
    { headers: { Accept: "application/vnd.github.sha" } }
  );
  if (resp.status !== 200) return null;
  return (await resp.text()).trim();
}

// --- HTTP handler ---

functions.http("ig-commit-trigger", async function (req, res) {
  res.header("Access-Control-Allow-Method", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Origin", "*");

  if (req.query?.action === "sweep") {
    return sweepHandler(req, res);
  }

  if (req.method === "OPTIONS") {
    return res.status(200).json({});
  }

  // Detect platform and parse payload
  const platform = detectPlatform(req.headers);

  // Reject non-push GitLab events early
  if (platform === "gitlab") {
    const gitlabEvent = req.headers["x-gitlab-event"];
    if (gitlabEvent && gitlabEvent !== "Push Hook") {
      return res.json({
        created: false,
        reason: "Only push events are supported",
      });
    }
  }

  /** @type {BuildRequest | { error: string }} */
  const parsed = platform === "gitlab"
    ? parseGitlabPayload(req.body)
    : parseGithubPayload(req.body);

  if ("error" in parsed) {
    console.error(parsed.error);
    return res.json({ created: false, reason: parsed.error });
  }

  const buildReq = /** @type {BuildRequest} */ (parsed);

  if (!(await hasIgIni(buildReq))) {
    return res.json({ created: false, reason: "No ig.ini found" });
  }

  const headSha = await resolveHead(buildReq);
  if (!headSha) {
    const platformName = buildReq.platform === "gitlab" ? "GitLab" : "GitHub";
    console.error(`Failed to resolve HEAD for ${buildReq.org}/${buildReq.repo}@${buildReq.branch}`);
    return res.status(502).json({
      created: false,
      reason: `Could not resolve branch HEAD from ${platformName}; not scheduling to avoid stale preemption`,
    });
  }

  try {
    const result = await scheduler.handleWebhook(
      buildReq.org, buildReq.repo, buildReq.branch, headSha,
      { cloneUrl: buildReq.cloneUrl, platformUrl: buildReq.baseUrl }
    );
    if (!result.ok) {
      return res.status(500).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error(e);
    throw e;
  }
});
