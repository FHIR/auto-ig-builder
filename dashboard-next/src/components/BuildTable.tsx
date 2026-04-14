import { useMemo, useCallback } from 'react'
import { useStore } from '../store'
import { mergeGroupedData } from '../merge'
import { applyViewConfig } from '../applyView'
import { RepoGroupView } from './RepoGroupView'
import { FlatRowView } from './FlatRowView'

export function BuildTable() {
  const builds = useStore(s => s.builds)
  const qas = useStore(s => s.qas)
  const branches = useStore(s => s.branches)
  const search = useStore(s => s.search)
  const viewConfig = useStore(s => s.viewConfig)
  const expandedRepos = useStore(s => s.expandedRepos)
  const toggleRepoExpanded = useStore(s => s.toggleRepoExpanded)

  const onToggle = useCallback((repo: string) => toggleRepoExpanded(repo), [toggleRepoExpanded])

  const repoGroups = useMemo(
    () => mergeGroupedData(builds, qas, branches),
    [builds, qas, branches]
  )

  const result = useMemo(
    () => applyViewConfig(repoGroups, viewConfig, search),
    [repoGroups, viewConfig, search]
  )

  if (result.mode === 'flat') {
    const failCount = result.rows.filter(r => r.branch.failing).length
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Repo</th>
              <th>Branch</th>
              <th>Version</th>
              <th>Date</th>
              <th>Status</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(row => (
              <FlatRowView key={`${row.repo}/${row.branch.branch}`} row={row} />
            ))}
            {result.rows.length === 0 && (
              <tr><td colSpan={6} className="empty">No matching branches</td></tr>
            )}
          </tbody>
        </table>
        <div className="table-footer">
          {result.rows.length} branches &middot; {failCount} failing
        </div>
      </div>
    )
  }

  // Grouped mode
  let totalBranches = 0
  let failingBranches = 0
  for (const g of result.groups) {
    totalBranches += g.allBranches.length
    failingBranches += g.allBranches.filter(b => b.failing).length
  }

  // For org grouping, track org boundaries
  let lastOrg = ''

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
          {result.groups.map(group => {
            const orgHeader = result.groupBy === 'org' && group.org !== lastOrg
            lastOrg = group.org
            return (
              <RepoGroupView
                key={group.repo}
                group={group}
                expanded={expandedRepos.has(group.repo)}
                onToggle={onToggle}
                orgHeader={orgHeader ? group.org : undefined}
              />
            )
          })}
          {result.groups.length === 0 && (
            <tr><td colSpan={5} className="empty">No matching IGs</td></tr>
          )}
        </tbody>
      </table>
      <div className="table-footer">
        {result.groups.length} IGs &middot; {totalBranches} branches &middot; {failingBranches} failing
      </div>
    </div>
  )
}
