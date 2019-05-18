# FHIR Implementation Guide Auto-Builder

## About Auto-Builder
Use this tool if: If you're working on an FHIR Implementation Guide in GitHub and want your work-in-progress to be visible as part of the FHIR Continuous Integration (CI) build service at https://build.fhir.org.

By following the instructions below, you can configure your GitHub repository to auto-build every time you make a commit (on any branch), and the resulting output (successful IG content, or debugging logs) will automatically be pushed to https://build.fhir.org.

## Quick start guide

0. **Create an IG** in a new folder, including *a file called `ig.json`* containing the IG definition, alongside any other content (for example a `pages` folder) that your IG requires.
1. **Put your IG on GitHub**: create a GitHub repository within your own organization, and push your content to GitHub.
2. **Add a Webhook in GitHub**: click "Settings", then "Webhooks & Services", then "Add Webhook".
3. **Configure the Webhook**: enter a URL of `https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger`. Choose "Content type" of `application/json` and accept the default (blank) "secret". Choose "Just the push event" as your trigger, and then click "Add webhook".

Now GitHub will automatically trigger a build whenever you commit changes. To manually trigger a build, you can `POST` to the Webhook URL yourself, for example:

```
curl -X POST  "https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger" \
  -H "Content-type: application/json" \
  --data '{"ref": "refs/heads/master", "repository": {"full_name": "test-igs/simple"}}'
```

*Note: a build takes 2-3 minutes to complete. You should see a notification at https://chat.fhir.org/#narrow/stream/179297-committers.2Fnotification/topic/ig-build.

## After the build is complete, you can...

### Find your rendered IG automatically available at

http://build.fhir.org/ig/:org/:repo/branches/:branch

(The master branch will also be available directly at http://build.fhir.org/ig/:org/:repo .)

### Find debugging info about the build

For a build log, see:
http://build.fhir.org/ig/:org/:repo/branches/:branch/build.log

(Logs for the master branch will also be available directly at http://build.fhir.org/ig/:org/:repo/build.log .)
