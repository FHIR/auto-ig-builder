# FHIR Implementation Guide Auto-Builder

## About Auto-Builder

Use this tool if: If you're working on an FHIR Implementation Guide in a **public GitHub repository** and want your work-in-progress to be visible as part of the FHIR Continuous Integration (CI) build service at https://build.fhir.org.

By following the instructions below, you can configure your GitHub repository to auto-build every time you make a commit (on any branch), and the resulting output (successful IG content, or debugging logs) will automatically be pushed to https://build.fhir.org.

## Quick start guide

0. **Create an IG** in a new folder, including *a file called `ig.ini` alongside any other content (for example a `pages` folder) that your IG requires. See https://confluence.hl7.org/display/FHIR/IG+Publisher+Documentation for full documentation.
1. **Put your IG on GitHub**: create a GitHub repository within your own organization, and push your content to GitHub.
2. **Add FHIR IG Builder**: Install https://github.com/apps/fhir-ig-builder on your org or repo. 

* *Now GitHub will automatically trigger a build whenever you commit changes. :-)*

* *Note: branch names containing characters other than alphanumerics, `_`, and `-` will **not work** with the auto-build infrastructure*

* *Note: a build takes 2-3 minutes to complete. You should see a notification at https://chat.fhir.org/#narrow/stream/179297-committers.2Fnotification/topic/ig-build .*


<details>
  <summary>Click to show alternative method (manually configured webhook)</summary>
* In your repo, click "Settings", then "Webhooks & Services", then "Add Webhook"
* Enter a URL of `https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger`
* Choose "Content type" of `application/json`
* Accept the default (blank) "secret".
* Choose "Just the push event" as your trigger
* Click "Add webhook".
* *Note: first webhook call will of type `ping` and will fail. That is (currently) OK. Once you make a commit and a push, a call of type `push` will be made and that should be successful if your setup is correct.

</details>



## After the build is complete, you can...

### Find your rendered IG automatically available at

https://build.fhir.org/ig/:org/:repo/branches/:branch

(The default branch will also be available directly at https://build.fhir.org/ig/:org/:repo .)

### Find debugging info about the build

For a build log, see:
https://build.fhir.org/ig/:org/:repo/branches/:branch/build.log

(Logs for the default branch will also be available directly at https://build.fhir.org/ig/:org/:repo/build.log .)

#### If you want to manually trigger a build

You can always push a new commit to your repo. But if you want to re-trigger a build for an existing commit, you have a couple of options. You can navigate through the GitHub UI within your repo to "Settings > Webhooks > ig-commit-trigger", scroll down to "Recent Deliveries," click the top one, and click "Redeliver.

Or if you want to trigger a build programatically, you can `POST` to the Webhook URL yourself, specifying a branch, org, and repo. For example with the `test-igs` org, `simple` repo, and `master` branch:

```
curl -X POST  "https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger" \
  -H "Content-type: application/json" \
  --data '{"ref": "refs/heads/master", "repository": {"full_name": "test-igs/simple"}}'
```

### Summary/stats of current ci builds
Latest summary/stats of the ci ig builds are available at [https://fhir.github.io/auto-ig-builder](https://fhir.github.io/auto-ig-builder/builds.html)
