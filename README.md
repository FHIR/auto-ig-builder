# FHIR Implementation Guide Auto-Builder

## Quick start guide

0. **Create an IG** in a new folder, including *a file called `ig.json`* containing the IG definition, alongside any other content (for example a `pages` folder) that your IG requires.
1. **Put your IG on GitHub**: create a GitHub repository within your own organization, and push your content to GitHub.
2. **Add a Webhook in GitHub**: click "Settings", then "Webhooks & Services", then "Add Webhook".
3. **Configure the Webhook**: enter a URL like `https://icbe5lqbof.execute-api.us-east-1.amazonaws.com/prod/publish?org=:org&repo=:repo` where `:org` is the organization of your project, and `:repo` is your repository. For example, if your IG source code is at https://github.com/test-igs/simple, then your org is `test-igs` and your repo is `simple`, so your Webhook URL is `https://icbe5lqbof.execute-api.us-east-1.amazonaws.com/prod/publish?org=test-igs&repo=simple`. You can accept the default "secret" and choose "Just the push event" as your trigger, and then click "Add webhook".

Now GitHub will automatically trigger a build whenever you commit changes. (To manually trigger a build, just `POST` to the Webhook URL yourself, for example via `curl -X POST`.)

*Note: a build takes 2-3 minutes to complete. Then you can...*

### Find your rendered IG automatically available at

http://build.fhir.org/:org/:repo

### Find debugging info about the build

http://build.fhir.org/:org/:repo/debug.tgz
