import functions from '@google-cloud/functions-framework';
import Api from "kubernetes-client";

import secret from "./secret.json" assert {
  type: 'json'
};

import job from "./job.json" assert {type: 'json'};

const config = {
  url: 'https://' + secret.clusterIp,
  ca: atob(secret.data['ca.crt']),
  auth: {
    bearer: atob(secret.data.token)
  }
};

const core = new Api.Core(config);
const batch = new Api.Batch(config);

functions.http("ig-commit-trigger", async function(req, res) {

  res.header("Access-Control-Allow-Method", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Origin", "*");

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.json({})
    return;
  }

  let org, repo, branch;
  try {
    [org, repo] = req.body.repository.full_name.split('/');
    branch = req.body.ref.split('/').slice(-1)[0];
    if (!org || !repo || !branch) {
      throw("Bad inputs");
    }
  } catch {
    throw(`Could not get org, branch, and repo from req.body.repository.full_name ${req?.body?.repository?.full_name} and req.body.ref ${req?.body?.ref}`);
  }

  const igIniUrl = `https://raw.githubusercontent.com/${org}/${repo}/${branch}/ig.ini`;
  const igIni = await fetch(igIniUrl);

  if (igIni.status !== 200) {
    throw("No ig.ini is present in " + igIniUrl);
  }

  const container = job.spec.template.spec.containers[0];
  container.env = container.env.concat([{
      "name": "IG_ORG",
      "value":org
    }, {
      "name": "IG_REPO",
      "value": repo
    }, {
      "name": "IG_BRANCH",
      "value": branch
  }]);

  batch.ns('fhir').jobs.post({body: job}, function(err, submitted){
    if (err) {
      console.log("Error submitting build job", JSON.stringify(err))
      throw "Error submitting job";
    }
    return res.status(200).json({
      'org': org,
      'repo': repo,
      'branch': branch
    });
  })
})
