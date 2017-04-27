# FHIR Implementation Guide Auto-Builder

## Quick start guide

0. **Create an IG** in a new folder, including *a file called `ig.json`* containing the IG definition, alongside any other content (for example a `pages` folder) that your IG requires.
1. **Put your IG on GitHub**: create a GitHub repository within your own organization, and push your content to GitHub.
2. **Add a Webhook in GitHub**: click "Settings", then "Webhooks & Services", then "Add Webhook".
3. **Configure the Webhook**: enter the URL `https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger` and choose "Content type" of "application/json". You can leave the "secret" blank.

Now GitHub will automatically trigger a build whenever you commit changes. (To manually trigger a build, just `POST` to the Webhook URL yourself, for example via `curl -X POST`.)

*Note: a build takes 2-3 minutes to complete. Then you can...*

### Find your rendered IG automatically available at

http://build.fhir.org/:org/:repo

### Find debugging info about the build

For a debug file including the fill input + output directory structure from the build process, see:  
http://build.fhir.org/:org/:repo/build.log
