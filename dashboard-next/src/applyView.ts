import type { ViewConfig, RepoGroup, BranchRow, ViewGroup, FlatRow, ViewResult } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return true
  try {
    return new RegExp(pattern, 'i').test(value)
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase())
  }
}

function filterBranches(branches: BranchRow[], config: ViewConfig, cutoff: Date): BranchRow[] {
  let result = branches

  // Time window ALWAYS applies when the control is shown
  if (config.controls.timeWindow) {
    result = result.filter(b => b.date.getTime() > cutoff.getTime())
  }

  // Apply branchFilter preset (composes with time window)
  switch (config.branchFilter) {
    case 'failing':
      result = result.filter(b => b.failing); break
    case 'master':
      result = result.filter(b => b.branch === 'master' || b.branch === 'main'); break
    // 'recent' is now redundant with the time window above, but kept for semantic clarity
    // 'all' does nothing extra
  }

  // Apply status filter
  if (config.statusFilter === 'failure') {
    result = result.filter(b => b.failing)
  } else if (config.statusFilter === 'success') {
    result = result.filter(b => !b.failing)
  }

  // Apply branch name pattern
  if (config.branchPattern) {
    result = result.filter(b => matchesPattern(b.branch, config.branchPattern))
  }

  return result
}

function sortBranches(branches: BranchRow[], config: ViewConfig): BranchRow[] {
  const sorted = [...branches]
  const dir = config.branchSortDir === 'asc' ? 1 : -1
  sorted.sort((a, b) => {
    switch (config.branchSort) {
      case 'name': return dir * a.branch.localeCompare(b.branch)
      case 'status': {
        const cmp = (a.failing ? 0 : 1) - (b.failing ? 0 : 1)
        return cmp !== 0 ? dir * cmp : b.date.getTime() - a.date.getTime()
      }
      case 'date':
      default: return dir * (a.date.getTime() - b.date.getTime())
    }
  })
  return sorted
}

function sortGroups(groups: ViewGroup[], config: ViewConfig): ViewGroup[] {
  const sorted = [...groups]
  const dir = config.groupSortDir === 'asc' ? 1 : -1
  sorted.sort((a, b) => {
    switch (config.groupSort) {
      case 'name': return dir * a.repo.localeCompare(b.repo)
      case 'failCount': {
        const cmp = a.allBranches.filter(br => br.failing).length - b.allBranches.filter(br => br.failing).length
        return cmp !== 0 ? dir * cmp : b.allBranches.reduce((m, br) => Math.max(m, br.date.getTime()), 0) - a.allBranches.reduce((m, br) => Math.max(m, br.date.getTime()), 0)
      }
      case 'branchCount': {
        const cmp = a.allBranches.length - b.allBranches.length
        return cmp !== 0 ? dir * cmp : b.allBranches.reduce((m, br) => Math.max(m, br.date.getTime()), 0) - a.allBranches.reduce((m, br) => Math.max(m, br.date.getTime()), 0)
      }
      case 'activity':
      default: {
        const ad = a.allBranches.reduce((m, br) => Math.max(m, br.date.getTime()), 0)
        const bd = b.allBranches.reduce((m, br) => Math.max(m, br.date.getTime()), 0)
        return dir * (ad - bd)
      }
    }
  })
  return sorted
}

export function applyViewConfig(
  repoGroups: RepoGroup[],
  config: ViewConfig,
  search: string,
): ViewResult {
  const cutoff = new Date(Date.now() - config.timeWindowDays * DAY_MS)

  let groups = repoGroups

  // Apply search filter
  if (search) {
    const q = search.toLowerCase()
    groups = groups.filter(g => g.repo.toLowerCase().includes(q))
  }

  // Apply repo pattern filter
  if (config.repoPattern) {
    groups = groups.filter(g => matchesPattern(g.repo, config.repoPattern))
  }

  // When time window is active, hide repos with no activity in the window
  if (config.controls.timeWindow) {
    groups = groups.filter(g => g.latestDate.getTime() > cutoff.getTime())
  }

  if (config.groupBy === 'none') {
    // Flat mode
    const rows: FlatRow[] = []
    for (const g of groups) {
      const branches = sortBranches(filterBranches(g.branches, config, cutoff), config)
      for (const b of branches) {
        rows.push({ org: g.org, repoName: g.repoName, repo: g.repo, branch: b })
      }
    }
    // Global sort for flat mode
    const dir = config.branchSortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      switch (config.branchSort) {
        case 'name': return dir * a.branch.branch.localeCompare(b.branch.branch)
        case 'status': {
          const cmp = (a.branch.failing ? 0 : 1) - (b.branch.failing ? 0 : 1)
          return cmp !== 0 ? dir * cmp : b.branch.date.getTime() - a.branch.date.getTime()
        }
        case 'date':
        default: return dir * (a.branch.date.getTime() - b.branch.date.getTime())
      }
    })
    return { mode: 'flat', rows }
  }

  // Grouped mode
  const viewGroups: ViewGroup[] = groups.map(g => {
    const allBranches = sortBranches(filterBranches(g.branches, config, cutoff), config)
    return {
      repo: g.repo, org: g.org, repoName: g.repoName,
      allBranches,
      visibleBranches: allBranches,
      hiddenCount: 0,
    }
  }).filter(g => g.allBranches.length > 0)

  // For org grouping, sort by org first then by groupSort within each org
  if (config.groupBy === 'org') {
    const sorted = sortGroups(viewGroups, config)
    sorted.sort((a, b) => a.org.localeCompare(b.org))
    return { mode: 'grouped', groupBy: 'org', groups: sorted }
  }

  return { mode: 'grouped', groupBy: 'repo', groups: sortGroups(viewGroups, config) }
}
