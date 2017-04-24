# Configure

```

kubectl create serviceaccount igbuild --namespace fhir
export SECRET=$(kubectl get serviceaccount igbuild --namespace fhir --output jsonpath={.secrets[0].name})
kubectl get secrets $SECRET --namespace fhir --output json > secret.json
```

#  Deploy

    gcloud beta functions deploy ig-commit-trigger  --stage-bucket ig-build --trigger-http
