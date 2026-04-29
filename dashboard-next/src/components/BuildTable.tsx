import { useMemo, useCallback, useState, useDeferredValue } from 'react'
import { useStore } from '../store'
import { mergeGroupedData } from '../merge'
import { applyViewConfig } from '../applyView'
import { RepoGroupView } from './RepoGroupView'
import { FlatRowView } from './FlatRowView'

const INITIAL_LIMIT = 5000
const PAGE_SIZE = 500

export function BuildTable() {
  const builds = useStore(s => s.builds)
  const qas = useStore(s => s.qas)
  const branches = useStore(s => s.branches)
  const search = useStore(s => s.search)
  const viewConfig = useStore(s => s.viewConfig)
  const expandedRepos = useStore(s => s.expandedRepos)
  const toggleRepoExpanded = useStore(s => s.toggleRepoExpanded)

  // Defer both search and view config so switches don't block input
  const deferredSearch = useDeferredValue(search)
  const deferredConfig = useDeferredValue(viewConfig)

  const onToggle = useCallback((repo: string) => toggleRepoExpanded(repo), [toggleRepoExpanded])

  const repoGroups = useMemo(
    () => mergeGroupedData(builds, qas, branches),
    [builds, qas, branches]
  )

  const result = useMemo(
    () => applyViewConfig(repoGroups, deferredConfig, deferredSearch),
    [repoGroups, deferredConfig, deferredSearch]
  )

  // Progressive rendering: cap how many rows we render
  const [renderLimit, setRenderLimit] = useState(INITIAL_LIMIT)
  const viewKey = deferredConfig.id + deferredSearch
  useMemo(() => setRenderLimit(INITIAL_LIMIT), [viewKey])

  if (result.mode === 'flat') {
    const totalCount = result.rows.length
    const failCount = result.rows.filter(r => r.branch.failing).length
    const visible = result.rows.slice(0, renderLimit)
    const remaining = totalCount - visible.length

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
            {visible.map(row => (
              <FlatRowView key={`${row.repo}/${row.branch.branch}`} row={row} />
            ))}
            {totalCount === 0 && (
              <tr><td colSpan={6} className="empty">No matching branches</td></tr>
            )}
          </tbody>
        </table>
        <div className="table-footer">
          {totalCount} branches &middot; {failCount} failing
          {remaining > 0 && (
            <>
              {' '}&middot;{' '}
              <button className="show-more-btn" onClick={() => setRenderLimit(r => r + PAGE_SIZE)}>
                show {Math.min(remaining, PAGE_SIZE)} more
              </button>
              {remaining > PAGE_SIZE && (
                <>
                  {' or '}
                  <button className="show-more-btn" onClick={() => setRenderLimit(totalCount)}>
                    show all {remaining}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // Grouped mode — cap groups rendered
  let totalBranches = 0
  let failingBranches = 0
  for (const g of result.groups) {
    totalBranches += g.allBranches.length
    failingBranches += g.allBranches.filter(b => b.failing).length
  }

  // Cap by total branch rows to keep DOM predictable
  const visibleGroups: typeof result.groups = []
  let rowBudget = renderLimit
  for (const g of result.groups) {
    if (rowBudget <= 0) break
    visibleGroups.push(g)
    rowBudget -= g.visibleBranches.length || 1
  }
  const remainingGroups = result.groups.length - visibleGroups.length
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
          {visibleGroups.map(group => {
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
        {remainingGroups > 0 && (
          <>
            {' '}&middot;{' '}
            <button className="show-more-btn" onClick={() => setRenderLimit(r => r + PAGE_SIZE)}>
              show {Math.min(remainingGroups, PAGE_SIZE)} more
            </button>
            {' or '}
            <button className="show-more-btn" onClick={() => setRenderLimit(Infinity)}>
              show all
            </button>
          </>
        )}
      </div>
    </div>
  )
}
