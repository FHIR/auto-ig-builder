# Infrastructure for VSTS Agent VM

```sh
$ az group create --name fhir-build-agent-rg  --location eastus
{
  "id": "/subscriptions/3b21d609-dca4-4c42-99fa-889ba7e4d1f2/resourceGroups/fhir-build-agent-rg",
  "location": "eastus",
  "managedBy": null,
  "name": "fhir-build-agent-rg",
  "properties": {
    "provisioningState": "Succeeded"
  },
  "tags": null
}

$ az group deployment create --name fhir-build-agent-deployment --resource-group fhir-build-agent-rg --template-file te
mplate.json  --parameters parameters.json
```


