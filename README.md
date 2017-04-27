# FHIR Implementation Guide Auto-Builder

## Quick start guide

0. **Create an IG** in a new folder, including *a file called `ig.json`* containing the IG definition, alongside any other content (for example a `pages` folder) that your IG requires.
1. **Put your IG on GitHub**: create a GitHub repository within your own organization, and push your content to GitHub.
2. **Add a Webhook in GitHub**: click "Settings", then "Webhooks & Services", then "Add Webhook".
3. **Configure the Webhook**: enter a URL of `https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger`. Choose "Content type" of `application/json` and accept the default (blank) "secret". Choose "Just the push event" as your trigger, and then click "Add webhook".

Now GitHub will automatically trigger a build whenever you commit changes. To manually trigger a build, you can `POST` to the Webhook URL yourself, for example:

```
curl -X POST  "https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger"
  -H "Content-type: application/json"
  --data '{"repository": {"full_name": "test-igs/simple"}}'
```

*Note: a build takes 2-3 minutes to complete. You should see a notification at https://chat.fhir.org/#narrow/stream/committers/topic/ig-build.

## After the build is complete, you can...

### Find your rendered IG automatically available at

http://build.fhir.org/:org/:repo

### Find debugging info about the build

For a build log, see:
http://build.fhir.org/:org/:repo/build.log
