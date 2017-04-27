var secret = require('./secret.json');
var job = require('./job.json');
var decode = require('base-64').decode;

var config = {
  url: 'https://' + secret.clusterIp,
  ca: decode(secret.data['ca.crt']),
  auth: {
    bearer: decode(secret.data.token)
  }
};

var Api = require('kubernetes-client');
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

    var env = job.spec.template.spec.containers[0].env;
    var envorg  = env[0];
    var envrepo = env[1];

    envorg.value = org;
    envrepo.value = repo;
    env.push({name: 'ZULIP_EMAIL', value: secret.zulip_email});
    env.push({name: 'ZULIP_API_KEY', value: secret.zulip_api_key});
    batch.ns('fhir').jobs.post({body: job}, function(err, submitted){
      console.log("ERR", JSON.stringify(err))
      console.log("RES", JSON.stringify(submitted, null,2))
      res && res.status(200).json({
        'org': org,
        'repo': repo,
        'submitted': submitted
      });
    })

};
