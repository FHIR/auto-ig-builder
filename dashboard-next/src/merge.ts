import type { Build, QA, BranchInfo, BranchRow, RepoGroup } from './types'

/**
 * Merges builds + qas + branches into repo groups with per-branch rows.
 * Each branch gets its date/version from QA data (latest entry per branch).
 * Pass/fail comes from the branches record (builds.json path structure).
 * Master branches are enriched with scraped build data when available.
 */
export function mergeGroupedData(
  builds: Build[],
  qas: QA[],
  branches: Record<string, BranchInfo>
): RepoGroup[] {
  // Index: repo+branch → latest QA entry
  const qaIndex = new Map<string, QA>()
  for (const qa of qas) {
    const key = `${qa.repo}/${qa.branch}`
    const existing = qaIndex.get(key)
    if (!existing || qa.date > existing.date) {
      qaIndex.set(key, qa)
    }
  }

  // Index: repo → build (for master enrichment, failure-first)
  const buildIndex = new Map<string, Build>()
  const sortedBuilds = [...builds].sort((a, b) => {
    if (a.failure && !b.failure) return -1
    if (b.failure && !a.failure) return 1
    return 0
  })
  for (const b of sortedBuilds) {
    if (!buildIndex.has(b.repo)) buildIndex.set(b.repo, b)
  }

  // Collect all repos from both sources
  const allRepos = new Set<string>()
  for (const repo of Object.keys(branches)) allRepos.add(repo)
  for (const qa of qas) allRepos.add(qa.repo)

  const groups: RepoGroup[] = []

  for (const repo of allRepos) {
    const org = repo.split('/')[0]
    const repoName = repo.split('/')[1]
    const branchInfo = branches[repo]

    // Collect all known branch names from both sources
    const branchNames = new Set<string>()
    if (branchInfo) {
      for (const b of branchInfo.branches) branchNames.add(b.name)
    }
    for (const qa of qas) {
      if (qa.repo === repo) branchNames.add(qa.branch)
    }

    const branchRows: BranchRow[] = []

    for (const branchName of branchNames) {
      const qa = qaIndex.get(`${repo}/${branchName}`)
      const branchMeta = branchInfo?.branches.find(b => b.name === branchName)
      const build = (branchName === 'master' || branchName === 'main')
        ? buildIndex.get(repo) : undefined

      const qaDate = qa?.date?.getTime() ?? 0
      const buildDate = build?.date?.getTime() ?? 0
      const date = new Date(Math.max(qaDate, buildDate))

      branchRows.push({
        branch: branchName,
        date,
        version: qa?.version ?? build?.version ?? null,
        failing: branchMeta?.failing ?? qa?.failure ?? false,
        qa,
      })
    }

    // Sort branches: newest first
    branchRows.sort((a, b) => b.date.getTime() - a.date.getTime())

    const latestDate = branchRows.length > 0
      ? branchRows[0].date
      : new Date(0)

    groups.push({ repo, org, repoName, latestDate, branches: branchRows })
  }

  // Sort repos by most recent activity
  groups.sort((a, b) => b.latestDate.getTime() - a.latestDate.getTime())

  return groups
}
