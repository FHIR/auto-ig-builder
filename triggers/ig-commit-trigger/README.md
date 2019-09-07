# Configure

```

kubectl create serviceaccount igbuild --namespace fhir
export SECRET=$(kubectl get serviceaccount igbuild --namespace fhir --output jsonpath={.secrets[0].name})
kubectl get secrets $SECRET --namespace fhir --output json > secret.json
```

Add secret.json[clusterIp] =  kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
Add secrets.json

```
"zulip_email": "fhir-bot@fhir.me",
"zulip_api_key": <READACTED>,
```



#  Deploy
    gcloud functions deploy ig-commit-trigger --runtime nodejs8 --trigger-http
