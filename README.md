# FHIR Implementation Guide Auto-Builder

## Quick start guide

1. Create a github repo within your own organization, and inside the repo, create a file called `ig.json` containing the IG definition, alongside the other content (`pages`, etc) that your IG requires.
2. Click "Settings" then "Webhooks & Services", then "Add Webhook"
3. Enter the value `https://2rxzc1u4ji.execute-api.us-east-1.amazonaws.com/prod/publish?org=:org&repo=:repo` where `:org` is the organization of your project, and `:repo` is your repo. For example, if your IG source code is at https://github.com/test-igs/simple, then your org is `test-igs` and your repo is `simple`, so your webhook URL is `https://2rxzc1u4ji.execute-api.us-east-1.amazonaws.com/prod/publish?org=test-igs&repo=simple`.

Now GitHub will automatically trigger a build whenever you commit changes.

To manually trigger a build, just `POST` to the webhook URL yourself (e.g., via `curl -X POST`).

*Note: a build takes 2-3 minutes.*

### Find your rendered IG automatically available at

http://ig.fhir.me/:org/:repo

### Find debugging info about the build

http://ig.fhir.me/:org/:repo/debug.tgz
