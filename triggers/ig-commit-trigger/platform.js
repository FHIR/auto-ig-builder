// @ts-check

/**
 * Platform detection and webhook payload parsing.
 * Extracted to allow testing without triggering index.js side effects (K8s client init).
 */

/**
 * @typedef {{
 *   platform: 'github' | 'gitlab',
 *   baseUrl: string,
 *   org: string,
 *   repo: string,
 *   branch: string,
 *   cloneUrl: string,
 * }} BuildRequest
 */

/**
 * Detect the source platform from request headers.
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {'github' | 'gitlab'}
 */
export function detectPlatform(headers) {
  if (headers["x-gitlab-event"]) return "gitlab";
  // Default to GitHub (backward compat with direct curl triggers)
  return "github";
}

/**
 * Parse a GitLab push webhook payload into a BuildRequest.
 * @param {any} body
 * @returns {BuildRequest | { error: string }}
 */
export function parseGitlabPayload(body) {
  const eventKind = body.object_kind;
  if (eventKind && eventKind !== "push") {
    return { error: "Only push events are supported" };
  }

  const pathWithNamespace = body.project?.path_with_namespace;
  const ref = body.ref;
  const gitHttpUrl = body.project?.git_http_url;

  if (!pathWithNamespace || !ref) {
    return { error: `Could not parse GitLab webhook: path_with_namespace=${pathWithNamespace} ref=${ref}` };
  }

  // Split path_with_namespace on last '/' to handle nested groups
  // e.g. "org/subgroup/my-ig" → namespace="org/subgroup", project="my-ig"
  const lastSlash = pathWithNamespace.lastIndexOf("/");
  if (lastSlash === -1) {
    return { error: `Invalid path_with_namespace: ${pathWithNamespace}` };
  }
  const namespace = pathWithNamespace.slice(0, lastSlash);
  const project = pathWithNamespace.slice(lastSlash + 1);

  const branch = ref.split("/").slice(-1)[0];
  if (!branch) {
    return { error: `Could not extract branch from ref: ${ref}` };
  }

  // Derive base URL from git_http_url (e.g. "https://gitlab.com/org/repo.git" → "https://gitlab.com")
  let baseUrl = "https://gitlab.com";
  if (gitHttpUrl) {
    try {
      const parsed = new URL(gitHttpUrl);
      baseUrl = `${parsed.protocol}//${parsed.host}`;
    } catch { /* fall back to default */ }
  }

  const cloneUrl = gitHttpUrl || `${baseUrl}/${pathWithNamespace}.git`;

  return {
    platform: "gitlab",
    baseUrl,
    org: `${baseUrl.replace(/^https?:\/\//, "")}/${namespace}`,
    repo: project,
    branch,
    cloneUrl,
  };
}

/**
 * Parse a GitHub push webhook payload into a BuildRequest.
 * @param {any} body
 * @returns {BuildRequest | { error: string }}
 */
export function parseGithubPayload(body) {
  try {
    const [org, ...repoParts] = body.repository.full_name.split("/");
    const repo = repoParts.join("/");
    const branch = body.ref.split("/").slice(-1)[0];
    if (!org || !repo || !branch) throw new Error("Bad inputs");

    return {
      platform: "github",
      baseUrl: "https://github.com",
      org,
      repo,
      branch,
      cloneUrl: `https://github.com/${org}/${repo}`,
    };
  } catch (e) {
    return {
      error: `Could not parse webhook: repository=${body?.repository?.full_name} ref=${body?.ref}`,
    };
  }
}
