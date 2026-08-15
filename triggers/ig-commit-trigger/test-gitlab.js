/**
 * Tests for GitLab webhook payload parsing and platform detection.
 *
 * Run:  node test-gitlab.js
 */

import { strict as assert } from "node:assert";
import { parseGitlabPayload, parseGithubPayload } from "./platform.js";

console.log("=== GitLab Webhook Parsing Tests ===\n");

// --- parseGitlabPayload ---

{
  console.log("TEST: Simple namespace (user/project)");
  const result = parseGitlabPayload({
    object_kind: "push",
    ref: "refs/heads/main",
    project: {
      path_with_namespace: "mike/diaspora",
      git_http_url: "https://gitlab.com/mike/diaspora.git",
    },
  });
  assert(!("error" in result));
  assert.equal(result.platform, "gitlab");
  assert.equal(result.org, "gitlab.com/mike");
  assert.equal(result.repo, "diaspora");
  assert.equal(result.branch, "main");
  assert.equal(result.cloneUrl, "https://gitlab.com/mike/diaspora.git");
  assert.equal(result.baseUrl, "https://gitlab.com");
  console.log("  PASS\n");
}

{
  console.log("TEST: Nested group namespace (group/subgroup/project)");
  const result = parseGitlabPayload({
    object_kind: "push",
    ref: "refs/heads/develop",
    project: {
      path_with_namespace: "org/subgroup/my-ig",
      git_http_url: "https://gitlab.com/org/subgroup/my-ig.git",
    },
  });
  assert(!("error" in result));
  assert.equal(result.org, "gitlab.com/org/subgroup");
  assert.equal(result.repo, "my-ig");
  assert.equal(result.branch, "develop");
  assert.equal(result.cloneUrl, "https://gitlab.com/org/subgroup/my-ig.git");
  console.log("  PASS\n");
}

{
  console.log("TEST: Deeply nested group (a/b/c/project)");
  const result = parseGitlabPayload({
    object_kind: "push",
    ref: "refs/heads/feature-x",
    project: {
      path_with_namespace: "a/b/c/project",
      git_http_url: "https://gitlab.com/a/b/c/project.git",
    },
  });
  assert(!("error" in result));
  assert.equal(result.org, "gitlab.com/a/b/c");
  assert.equal(result.repo, "project");
  assert.equal(result.branch, "feature-x");
  console.log("  PASS\n");
}

{
  console.log("TEST: Self-hosted GitLab instance");
  const result = parseGitlabPayload({
    object_kind: "push",
    ref: "refs/heads/main",
    project: {
      path_with_namespace: "health/fhir-ig",
      git_http_url: "https://gitlab.example.com/health/fhir-ig.git",
    },
  });
  assert(!("error" in result));
  assert.equal(result.baseUrl, "https://gitlab.example.com");
  assert.equal(result.org, "gitlab.example.com/health");
  assert.equal(result.repo, "fhir-ig");
  assert.equal(result.cloneUrl, "https://gitlab.example.com/health/fhir-ig.git");
  console.log("  PASS\n");
}

{
  console.log("TEST: Reject non-push event (tag_push)");
  const result = parseGitlabPayload({
    object_kind: "tag_push",
    ref: "refs/tags/v1.0.0",
    project: {
      path_with_namespace: "org/repo",
      git_http_url: "https://gitlab.com/org/repo.git",
    },
  });
  assert("error" in result);
  assert.equal(result.error, "Only push events are supported");
  console.log("  PASS\n");
}

{
  console.log("TEST: Missing path_with_namespace");
  const result = parseGitlabPayload({
    object_kind: "push",
    ref: "refs/heads/main",
    project: {},
  });
  assert("error" in result);
  assert.ok(result.error.includes("Could not parse"));
  console.log("  PASS\n");
}

{
  console.log("TEST: Missing ref");
  const result = parseGitlabPayload({
    object_kind: "push",
    project: {
      path_with_namespace: "org/repo",
      git_http_url: "https://gitlab.com/org/repo.git",
    },
  });
  assert("error" in result);
  assert.ok(result.error.includes("Could not parse"));
  console.log("  PASS\n");
}

// --- parseGithubPayload (backward compat) ---

{
  console.log("TEST: GitHub payload parsing (backward compat)");
  const result = parseGithubPayload({
    repository: { full_name: "HL7/US-Core" },
    ref: "refs/heads/master",
  });
  assert(!("error" in result));
  assert.equal(result.platform, "github");
  assert.equal(result.org, "HL7");
  assert.equal(result.repo, "US-Core");
  assert.equal(result.branch, "master");
  assert.equal(result.cloneUrl, "https://github.com/HL7/US-Core");
  assert.equal(result.baseUrl, "https://github.com");
  console.log("  PASS\n");
}

{
  console.log("TEST: GitHub payload with missing repository");
  const result = parseGithubPayload({ ref: "refs/heads/main" });
  assert("error" in result);
  assert.ok(result.error.includes("Could not parse"));
  console.log("  PASS\n");
}

// --- Env var injection (scheduling integration) ---

{
  console.log("TEST: handleWebhook passes cloneUrl/platformUrl to buildJob");

  // Import and create a scheduler with mock K8s clients to inspect the created job
  const { createScheduler } = await import("./scheduling.js");
  const jobSourceImport = (await import("./job.json", { with: { type: "json" } })).default;

  let createdJob = null;
  const mockBatch = {
    listNamespacedJob: async () => ({ items: [] }),
    createNamespacedJob: async ({ body }) => { createdJob = body; return {}; },
    deleteNamespacedJob: async () => ({}),
    patchNamespacedJob: async () => ({}),
  };
  const mockCore = {
    listNamespacedPod: async () => ({ items: [] }),
  };

  const scheduler = createScheduler({
    k8sBatch: /** @type {any} */ (mockBatch),
    k8sCore: /** @type {any} */ (mockCore),
    jobSource: JSON.parse(JSON.stringify(jobSourceImport)),
    managedByLabel: "ig-trigger",
    jobNamePrefix: "igbuild",
    branchKeyScope: "",
  });

  await scheduler.handleWebhook("gitlab.com/org", "my-ig", "main", "abc123def", {
    cloneUrl: "https://gitlab.com/org/my-ig.git",
    platformUrl: "https://gitlab.com",
  });

  assert.ok(createdJob, "Expected a job to be created");
  const container = createdJob.spec.template.spec.containers[0];
  const envMap = Object.fromEntries(container.env.map((e) => [e.name, e.value]));

  assert.equal(envMap.IG_ORG, "gitlab.com/org");
  assert.equal(envMap.IG_REPO, "my-ig");
  assert.equal(envMap.IG_BRANCH, "main");
  assert.equal(envMap.IG_CLONE_URL, "https://gitlab.com/org/my-ig.git");
  assert.equal(envMap.IG_PLATFORM_URL, "https://gitlab.com");

  // Check platform annotation
  assert.equal(
    createdJob.metadata.annotations["build.fhir.org/platform"],
    "https://gitlab.com"
  );

  console.log("  PASS\n");
}

{
  console.log("TEST: handleWebhook for GitHub does NOT add IG_CLONE_URL when not provided");

  const { createScheduler } = await import("./scheduling.js");
  const jobSourceImport = (await import("./job.json", { with: { type: "json" } })).default;

  let createdJob = null;
  const mockBatch = {
    listNamespacedJob: async () => ({ items: [] }),
    createNamespacedJob: async ({ body }) => { createdJob = body; return {}; },
    deleteNamespacedJob: async () => ({}),
    patchNamespacedJob: async () => ({}),
  };
  const mockCore = {
    listNamespacedPod: async () => ({ items: [] }),
  };

  const scheduler = createScheduler({
    k8sBatch: /** @type {any} */ (mockBatch),
    k8sCore: /** @type {any} */ (mockCore),
    jobSource: JSON.parse(JSON.stringify(jobSourceImport)),
    managedByLabel: "ig-trigger",
    jobNamePrefix: "igbuild",
    branchKeyScope: "",
  });

  await scheduler.handleWebhook("HL7", "US-Core", "master", "sha123");

  assert.ok(createdJob, "Expected a job to be created");
  const container = createdJob.spec.template.spec.containers[0];
  const envMap = Object.fromEntries(container.env.map((e) => [e.name, e.value]));

  assert.equal(envMap.IG_ORG, "HL7");
  assert.equal(envMap.IG_REPO, "US-Core");
  assert.equal(envMap.IG_BRANCH, "master");
  assert.equal(envMap.IG_CLONE_URL, undefined, "Should not have IG_CLONE_URL when not provided");
  assert.equal(envMap.IG_PLATFORM_URL, undefined, "Should not have IG_PLATFORM_URL when not provided");

  // No platform annotation for GitHub
  assert.equal(
    createdJob.metadata.annotations["build.fhir.org/platform"],
    undefined
  );

  console.log("  PASS\n");
}

console.log("All GitLab tests passed.");
