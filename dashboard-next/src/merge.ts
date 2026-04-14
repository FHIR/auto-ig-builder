import type { Build, QA, BranchInfo, MergedRow } from './types'

/**
 * Merges builds + qas + branches into display rows.
 * Preserves the original merge semantics:
 *  - Both arrays sorted by repo, then master-first, then failure-first
 *  - First match per repo used (failure entry wins due to sort order)
 *  - Date = max(qa.date, build.date)
 *  - Version = qa.version preferred, fallback to build.version
 *  - Success = build not failed AND qa exists without exception
 *
 * Optimized: uses Maps for O(1) lookups instead of O(n) find().
 */
export function mergeData(
  builds: Build[],
  qas: QA[],
  branches: Record<string, BranchInfo>
): MergedRow[] {
  const sorter = (a: { repo: string; master: boolean; failure: boolean }, b: { repo: string; master: boolean; failure: boolean }) => {
    if (a.repo < b.repo) return -1
    if (a.repo > b.repo) return 1
    if (a.master && !b.master) return -1
    if (b.master && !a.master) return 1
    if (a.failure && !b.failure) return -1
    if (b.failure && !a.failure) return 1
    return 0
  }

  // Sort then index by repo (first match wins, preserving failure-first order)
  const sortedBuilds = [...builds].sort(sorter)
  const sortedQas = [...qas].sort(sorter)

  const buildByRepo = new Map<string, Build>()
  for (const b of sortedBuilds) {
    if (!buildByRepo.has(b.repo)) buildByRepo.set(b.repo, b)
  }

  const qaByRepo = new Map<string, QA>()
  for (const q of sortedQas) {
    if (!qaByRepo.has(q.repo)) qaByRepo.set(q.repo, q)
  }

  // Collect unique repo keys from master entries of both sources
  const seen = new Set<string>()
  const repoKeys: string[] = []
  for (const q of sortedQas) {
    if (q.master && !seen.has(q.repo)) {
      seen.add(q.repo)
      repoKeys.push(q.repo)
    }
  }
  for (const b of sortedBuilds) {
    if (b.master && !seen.has(b.repo)) {
      seen.add(b.repo)
      repoKeys.push(b.repo)
    }
  }

  return repoKeys.map(repo => {
    const build = buildByRepo.get(repo)
    const qa = qaByRepo.get(repo)

    const date = new Date(Math.max(
      qa?.date?.getTime() ?? 0,
      build?.date?.getTime() ?? 0
    ))

    return {
      org: repo.split('/')[0],
      repoName: repo.split('/')[1],
      repo,
      date,
      version: qa?.version ?? build?.version ?? null,
      success: !(build?.failure) && !!(qa && !qa.exception),
      build,
      qa,
      branches: branches[repo]?.branches ?? [{ name: 'master', failing: false }],
    }
  })
}
