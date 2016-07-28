# FHIR IG Auto-Builder

To use the auto-build infrastructure:

1. Create a github repo within your own organization, and inside the repo, create a file called `ig.json` containing the IG definition. For example, org=`test-igs`, repo=`simple`: https://github.com/test-igs/simple
2. Click "Settings" then "Webhooks & Services", then "Add Webhook"
3. Enter the value `https://2rxzc1u4ji.execute-api.us-east-1.amazonaws.com/prod/publish?org=:org&repo=:repo` where `:org` is the organization of your project, and `:repo` is your repo. For the example above: `https://2rxzc1u4ji.execute-api.us-east-1.amazonaws.com/prod/publish?org=test-igs&repo=simple`.

Now GitHub will automatically trigger a build whenever you commmite changes.

To manually trigger a build, just `POST` to the webhook URL yourself:

    curl -X POST "https://2rxzc1u4ji.execute-api.us-east-1.amazonaws.com/prod/publish?org=test-igs&repo=simple"

# Find your IG built automatically at

http://ig.fhir.me/:org/:repo

# Find debugging info about the build

http://ig.fhir.me/:org/:repo/debug.tgz
