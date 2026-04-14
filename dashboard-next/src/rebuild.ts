const rebuilt = new Set<string>()

export function triggerRebuild(org: string, repo: string, branch: string): boolean {
  const key = `${org}/${repo}/${branch}`
  if (rebuilt.has(key)) return false
  rebuilt.add(key)

  fetch('https://us-central1-fhir-org-starter-project.cloudfunctions.net/ig-commit-trigger', {
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      repository: { full_name: `${org}/${repo}` },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    referrer: 'no-referrer',
    mode: 'cors',
  })

  return true
}

export function isRebuilt(org: string, repo: string, branch: string): boolean {
  return rebuilt.has(`${org}/${repo}/${branch}`)
}
