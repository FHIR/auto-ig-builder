# Infrastructure for VSTS Agent VM

## Deploy it

```sh
$ az group create \
  --name fhir-build-agent-rg \
  --location eastus

$ az group deployment create \
  --name fhir-build-agent-deployment \
  --resource-group fhir-build-agent-rg \
  --template-file template.json \
  --parameters parameters.json
```


