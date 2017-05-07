var request = require('request');
var secret = require('./secret.json');
var decode = require('base-64').decode;

var config = {
  url: 'https://' + secret.clusterIp,
  ca: decode(secret.data['ca.crt']),
  auth: {
    bearer: decode(secret.data.token)
  }
};

exports['container-deploy-trigger'] = function helloPubSub (event, callback) {
  console.log("called!");
  const pubsubMessage = event.data;
  const result = JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString());
  console.log("result");
  console.log(result);
  if (result.status === 'SUCCESS' && result.steps[0].dir === 'gforge-to-zulip') {
    request({
      url: 'https://' + secret.clusterIp + '/apis/extensions/v1beta1/namespaces/fhir/deployments/gforge-to-zulip',
      ca: decode(secret.data['ca.crt']),
      method: 'PATCH',
      body: [{"op": "replace", "value": result.images[0],  "path": "/spec/template/spec/containers/0/image"}],
      json: true,
      headers: {
        'Content-type': 'application/json-patch+json',
        'Authorization': 'Bearer ' + decode(secret.data.token)
      }
    }, function(err, response, body){
      console.log("err?", err);
      console.log(body);
      callback();
    });
  }
};
