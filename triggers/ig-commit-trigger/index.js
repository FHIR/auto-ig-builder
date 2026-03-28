// @ts-check

import functions from "@google-cloud/functions-framework";
import * as k8s from "@kubernetes/client-node";
import jobSource from "./job.json" with { type: "json" };
import { createScheduler } from "./scheduling.js";

const kc = new k8s.KubeConfig();
kc.loadFromFile("sa.kubeconfig");

const scheduler = createScheduler({
  k8sBatch: kc.makeApiClient(k8s.BatchV1Api),
  k8sCore: kc.makeApiClient(k8s.CoreV1Api),
  jobSource,
  patchOptions: k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.StrategicMergePatch),
});

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} branch
 */
async function resolveHead(org, repo, branch) {
  const resp = await fetch(
    `https://api.github.com/repos/${org}/${repo}/commits/${encodeURIComponent(branch)}`,
    { headers: { Accept: "application/vnd.github.sha" } }
  );
  if (resp.status !== 200) return null;
  return (await resp.text()).trim();
}

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} branch
 */
async function hasIgIni(org, repo, branch) {
  const resp = await fetch(
    `https://raw.githubusercontent.com/${org}/${repo}/${encodeURIComponent(branch)}/ig.ini`
  );
  return resp.status === 200;
}

functions.http("ig-commit-trigger", async function (req, res) {
  res.header("Access-Control-Allow-Method", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).json({});
  }

  let org, repo, branch;
  try {
    [org, repo] = req.body.repository.full_name.split("/");
    branch = req.body.ref.split("/").slice(-1)[0];
    if (!org || !repo || !branch) throw new Error("Bad inputs");
  } catch (e) {
    console.error(e);
    return res.json({
      created: false,
      reason: `Could not parse webhook: repository=${req?.body?.repository?.full_name} ref=${req?.body?.ref}`,
    });
  }

  if (!(await hasIgIni(org, repo, branch))) {
    return res.json({ created: false, reason: "No ig.ini found" });
  }

  const headSha = await resolveHead(org, repo, branch);
  if (!headSha) {
    console.error(`Failed to resolve HEAD for ${org}/${repo}@${branch}`);
    return res.status(502).json({
      created: false,
      reason: "Could not resolve branch HEAD from GitHub; not scheduling to avoid stale preemption",
    });
  }

  try {
    const result = await scheduler.handleWebhook(org, repo, branch, headSha);
    if (!result.ok) {
      return res.status(500).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error(e);
    throw e;
  }
});
