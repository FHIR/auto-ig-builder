var secret = require('./secret.json');
var job = require('./job.json');
var decode = require('base-64').decode;
var Api = require('kubernetes-client');

var config = {
  url: 'https://' + secret.clusterIp,
  ca: decode(secret.data['ca.crt']),
  auth: {
    bearer: decode(secret.data.token)
  }
};

const core = new Api.Core(config);
const batch = new Api.Batch(config);

function print(err, result) {
  console.log(JSON.stringify(err || result, null, 2));
}

exports["ig-commit-trigger"] = function(req, res) {

  console.log("BODY 2", req.body);
  var target = req.body.repository.full_name.split('/');
  var org = target[0];
  var repo = target[1];

  console.log("JOB", job);

  job.spec.template.spec.containers[0].env = [{
      "name": "IG_ORG",
      "value":org
    }, {
      "name": "IG_REPO",
      "value": repo
    }, {
      "name": "ZULIP_EMAIL",
      "value": secret.zulip_email
    }, {
      "name": "ZULIP_API_KEY",
      "value": secret.zulip_api_key
  }, {
      "name": "JAVA_MEMORY",
      "value": "3750m"
  }];

  batch.ns('fhir').jobs.post({body: job}, function(err, submitted){
    console.log("ERR", JSON.stringify(err))
    console.log("RES", JSON.stringify(submitted, null,2))
    res && res.status(200).json({
      'org': org,
      'repo': repo //,
      // 'submitted': submitted
    });
  })

};
