var secret = require('./secret.json');
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

exports['container-deploy-trigger'] = function helloPubSub (event, callback) {
  console.log("called!");
  const pubsubMessage = event.data;
  const result = JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString());
  console.log("result", result);

  if (result.status !== 'SUCCESS'){
    return callback();
  }

  const target = result.steps[0].dir.split('images/')[1];
  core.ns('fhir').po.delete({qs: {labelSelector: `run=${target}`}}, callback);
  if (!target){
    return callback();
  }
};
