import { useMemo, useCallback } from 'react'
import { useStore } from '../store'
import { mergeGroupedData } from '../merge'
import { RepoGroupView } from './RepoGroupView'

const DAY_MS = 24 * 60 * 60 * 1000

export function BuildTable() {
  const builds = useStore(s => s.builds)
  const qas = useStore(s => s.qas)
  const branches = useStore(s => s.branches)
  const search = useStore(s => s.search)
  const statusFilter = useStore(s => s.statusFilter)
  const timeWindowDays = useStore(s => s.timeWindowDays)
  const expandedRepos = useStore(s => s.expandedRepos)
  const toggleRepoExpanded = useStore(s => s.toggleRepoExpanded)

  const onToggle = useCallback((repo: string) => toggleRepoExpanded(repo), [toggleRepoExpanded])

  const cutoff = new Date(Date.now() - timeWindowDays * DAY_MS)

  const { groups, totalBranches, failingBranches } = useMemo(() => {
    let groups = mergeGroupedData(builds, qas, branches)

    // Only show repos with any activity within the time window
    groups = groups.filter(g => g.latestDate.getTime() > cutoff.getTime())

    if (search) {
      const q = search.toLowerCase()
      groups = groups.filter(g => g.repo.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      groups = groups.filter(g =>
        g.branches.some(b => statusFilter === 'failure' ? b.failing : !b.failing)
      )
    }

    let totalBranches = 0
    let failingBranches = 0
    for (const g of groups) {
      totalBranches += g.branches.length
      failingBranches += g.branches.filter(b => b.failing).length
    }

    return { groups, totalBranches, failingBranches }
  }, [builds, qas, branches, search, statusFilter, cutoff.getTime()])

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Branch</th>
            <th>Version</th>
            <th>Date</th>
            <th>Status</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <RepoGroupView
              key={group.repo}
              group={group}
              expanded={expandedRepos.has(group.repo)}
              onToggle={onToggle}
              cutoff={cutoff}
              statusFilter={statusFilter}
            />
          ))}
          {groups.length === 0 && (
            <tr><td colSpan={5} className="empty">No matching IGs</td></tr>
          )}
        </tbody>
      </table>
      <div className="table-footer">
        {groups.length} IGs &middot; {totalBranches} branches &middot; {failingBranches} failing
      </div>
    </div>
  )
}
