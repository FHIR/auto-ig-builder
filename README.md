# FHIR Implementation Guide Auto-Builder

## About Auto-Builder

Use this tool if you're working on an FHIR Implementation Guide in a **public GitHub or GitLab repository** and want your work-in-progress to be visible as part of the FHIR Continuous Integration (CI) build service at https://build.fhir.org/ig/.

By following the instructions below, you can configure your repository to auto-build every time you make a commit (on any branch), and the resulting output (successful IG content, or debugging logs) will automatically be pushed to https://build.fhir.org/ig/.

## Quick start guide (GitHub)

0. **Create an IG** in a new folder, including a file called `ig.ini` alongside any other content (for example a `pages` folder) that your IG requires. See https://confluence.hl7.org/display/FHIR/IG+Publisher+Documentation for full documentation.
1. **Put your IG on GitHub**: create a public GitHub repository within your own organization, and push your content to GitHub.
2. **Add FHIR IG Builder**: Install https://github.com/apps/fhir-ig-builder on your org or repo. 

**Now GitHub will automatically trigger a build whenever you commit changes. :-)**

### Important Notes
* branches are `[A-Za-z0-9_-]` only. Other characters such as **`/` will not work in branch names**
* build notifications at https://chat.fhir.org/#narrow/stream/179297-committers.2Fnotification/topic/ig-build
* builds takes 2-3 minutes to complete

<details>
  <summary>Click to show alternative method (manually configured webhook)</summary>
In your repo, click "Settings", then "Webhooks & Services", then "Add Webhook"
Enter a URL of `https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger`
Choose "Content type" of `application/json`
Accept the default (blank) "secret".
Choose "Just the push event" as your trigger
Click "Add webhook".
Note: first webhook call will of type `ping` and will fail. That is (currently) OK. Once you make a commit and a push, a call of type `push` will be made and that should be successful if your setup is correct.

</details>

## Quick start guide (GitLab)

0. **Create an IG** in a new folder, including a file called `ig.ini` alongside any other content that your IG requires. See https://confluence.hl7.org/display/FHIR/IG+Publisher+Documentation for full documentation.
1. **Put your IG on GitLab**: create a **public** GitLab project (on gitlab.com or a publicly-accessible self-hosted instance) and push your content.
2. **Add a webhook**: In your project, go to **Settings → Webhooks → Add new webhook**:
   - **URL**: `https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger`
   - **Trigger**: Check **Push events** only
   - Leave "Secret token" blank
   - Click **Add webhook**

**Now GitLab will automatically trigger a build whenever you push changes. :-)**

### GitLab Important Notes
* Only **public** repositories are supported (the builder clones without authentication)
* Branches are `[A-Za-z0-9_-]` only — same restriction as GitHub
* Nested groups are supported (e.g. `org/subgroup/my-ig`)
* Builds take 2-3 minutes to complete
* Build notifications appear at https://chat.fhir.org/#narrow/stream/179297-committers.2Fnotification/topic/ig-build

### Finding your GitLab IG build output

Your rendered IG will be available at:

```
https://build.fhir.org/ig/gitlab.com/:namespace/:project/branches/:branch
```

For example, if your project is at `gitlab.com/csiro/my-fhir-ig` on branch `main`:

```
https://build.fhir.org/ig/gitlab.com/csiro/my-fhir-ig/branches/main
```

The default branch is also available at:
```
https://build.fhir.org/ig/gitlab.com/:namespace/:project
```

### Manually triggering a GitLab build

You can `POST` a GitLab-style payload directly:

```
curl -X POST "https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger" \
  -H "Content-Type: application/json" \
  -H "X-Gitlab-Event: Push Hook" \
  --data '{
    "object_kind": "push",
    "ref": "refs/heads/main",
    "project": {
      "path_with_namespace": "myorg/my-ig",
      "git_http_url": "https://gitlab.com/myorg/my-ig.git"
    }
  }'
```



## After the build is complete, you can...

### Find your rendered IG automatically available at

https://build.fhir.org/ig/:org/:repo/branches/:branch

(The default branch will also be available directly at https://build.fhir.org/ig/:org/:repo .)

### Find debugging info about the build

For a build log, see:
https://build.fhir.org/ig/:org/:repo/branches/:branch/build.log

(Logs for the default branch will also be available directly at https://build.fhir.org/ig/:org/:repo/build.log .)

In case the build failed, the log will be available in https://build.fhir.org/ig/:org/:repo/branches/:branch/failure/build.log

#### If you want to manually trigger a build

You can always push a new commit to your repo. But if you want to re-trigger a build for an existing commit, you have a couple of options.

You can use the dashboard at https://fhir.github.io/auto-ig-builder.

Or if you're using web hooks, you can navigate through the GitHub UI within your repo to "Settings > Webhooks > ig-commit-trigger", scroll down to "Recent Deliveries," click the top one, and click "Redeliver.

Or if you want to trigger a build programatically, you can `POST` to the Webhook URL yourself, specifying a branch, org, and repo. For example with the `test-igs` org, `simple` repo, and `master` branch:

```
curl -X POST  "https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger" \
  -H "Content-type: application/json" \
  --data '{"ref": "refs/heads/master", "repository": {"full_name": "test-igs/simple"}}'
```

### Summary/stats of current ci builds
Latest summary/stats of the ci ig builds are available at [https://fhir.github.io/auto-ig-builder](https://fhir.github.io/auto-ig-builder/builds.html)

# IG Auto-Builder Purge Policy

## Automated Cleanup

* Branches older than 90 days with no activity are automatically removed
* Only main branches (`main` or `master`) of official HL7, FHIR, IHE, and Argonaut repositories are exempt from purging

## Keeping Your Branch

* Make a commit to your branch at least once every 90 days to prevent purging
* For repositories not in the exempted organizations, even main branches will be purged if inactive

## After Purging

* Purged content cannot be restored from the build service
* Your GitHub source code remains unaffected
* You can rebuild by pushing to the same branch again
---

## Developer Overview

* [Dev Setup](./k8s/dev-setup.md)
* [Architecture Overview Slide](https://docs.google.com/presentation/d/12JykZwSdQ1pwSuzP2fGZSXr3jYMmvEcwVgNAy3dWr_U/present)
* [Accompanying Video](https://youtu.be/VVbF1O4pgQA)
