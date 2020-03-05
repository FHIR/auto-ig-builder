# Infrastructure for VSTS Agent VM

## Deploy it

```sh
$ az group create \
  --name fhir-build-agent-rg \
  --location eastus

# Here, you'll be prompted for a VSTS PAT (personal access token)
$ az group deployment create \
  --name fhir-build-agent-deployment \
  --resource-group fhir-build-agent-rg \
  --template-file template.json \
  --parameters parameters.json
  
```

VSTS also requires environment variables: `deploy_key_encrypted` and `deploy_key_passphrase`.

```
export DEPLOY_KEY_PASSPHRASE=$(openssl rand -hex 256)
export DEPLOY_KEY_ENCRYPTED=$(cat deploy.build.fhir.org | openssl enc -aes-256-cbc -pass pass:$DEPLOY_KEY_PASSPHRASE -base64 -A)
```

Later in VSTS to decrypt:

```
echo $DEPLOY_KEY_ENCRYPTED | openssl enc -aes-256-cbc -d -pass pass:$DEPLOY_KEY_PASSPHRASE -base64 -A > ${BUILD_REPOSITORY_LOCALPATH}/deploy.rsa
```
