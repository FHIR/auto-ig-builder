import functions from "@google-cloud/functions-framework";
import k8s from "@kubernetes/client-node";
import jobSource from "./job.json" assert { type: "json" };

const kc = new k8s.KubeConfig();
kc.loadFromFile("sa.kubeconfig");
const k8sBatch = kc.makeApiClient(k8s.BatchV1Api);

functions.http("ig-commit-trigger", async function (req, res) {
  res.header("Access-Control-Allow-Method", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.status(200);
    res.json({});
    return;
  }

  let org, repo, branch, commitHash;
  try {
    [org, repo] = req.body.repository.full_name.split("/");
    branch = req.body.ref.split("/").slice(-1)[0];
    commitHash = "" + req.body.after;
    if (!org || !repo || !branch) {
      throw "Bad inputs";
    }
  } catch(e) {
    console.error(e)
    return res.json({
      created: false,
      reason: `Could not get org, branch, and repo from
      req.body.repository.full_name
        ${req?.body?.repository?.full_name}
      req.body.ref
        ${req?.body?.ref}`,
    });
  }

  const jobGroupId = `igbuild-${org}-${repo}-${branch}`.toLocaleLowerCase();

  const jobId = `igbuild-${commitHash.slice(0, 6)}-${org}-${repo}-${branch}`
    .toLocaleLowerCase()
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 63);

  const igIniUrl = `https://raw.githubusercontent.com/${org}/${repo}/${branch}/ig.ini`;
  const igIni = await fetch(igIniUrl);

  if (igIni.status !== 200) {
    return res.json({ created: false, reason: "No ig.ini found" });
  }

  const job = JSON.parse(JSON.stringify(jobSource));
  job.metadata.name = jobId;
  job.metadata.labels["job-group-id"] = jobGroupId;
  job.spec.template.spec.containers.forEach((container) => {
    container.env = container.env.concat([
      {
        name: "IG_ORG",
        value: org,
      },
      {
        name: "IG_REPO",
        value: repo,
      },
      {
        name: "IG_BRANCH",
        value: branch,
      },
    ]);
  });

  try {
    const existing = await k8sBatch.listNamespacedJob("fhir", false, false, undefined, undefined, `job-group-id=${jobGroupId}`);
    const created = await k8sBatch.createNamespacedJob("fhir", job);

    console.log("Kill existing jobs", existing?.body?.items?.map(j => j?.metadata?.name))
    await Promise.all(existing?.body?.items?.map((i) => k8sBatch.deleteNamespacedJob(i.metadata.name, "fhir")))

    return res.status(200).json({
      created: true,
      org: org,
      repo: repo,
      branch: branch,
      jobId: jobId,
    });
  } catch (e) {
    if (e.body?.message?.includes("already exists")) {
      return res
        .status(200)
        .json({ created: false, reason: "Job already exists" });
    } else {
      console.error(e)
      throw e;
    }
  }
});
