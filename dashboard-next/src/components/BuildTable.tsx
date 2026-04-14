import { useMemo, useCallback } from 'react'
import { useStore } from '../store'
import { mergeData } from '../merge'
import { BuildRow } from './BuildRow'
import type { SortColumn } from '../types'

const columns: { key: SortColumn; label: string }[] = [
  { key: 'repo', label: 'IG' },
  { key: 'version', label: 'Version' },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
]

export function BuildTable() {
  const builds = useStore(s => s.builds)
  const qas = useStore(s => s.qas)
  const branches = useStore(s => s.branches)
  const search = useStore(s => s.search)
  const statusFilter = useStore(s => s.statusFilter)
  const sortColumn = useStore(s => s.sortColumn)
  const sortAsc = useStore(s => s.sortAsc)
  const toggleSort = useStore(s => s.toggleSort)
  const expandedRow = useStore(s => s.expandedRow)
  const toggleExpanded = useStore(s => s.toggleExpanded)

  const onToggle = useCallback((repo: string) => toggleExpanded(repo), [toggleExpanded])

  const rows = useMemo(() => {
    let merged = mergeData(builds, qas, branches)

    if (search) {
      const q = search.toLowerCase()
      merged = merged.filter(r => r.repo.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      merged = merged.filter(r => (statusFilter === 'success') === r.success)
    }

    merged.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'repo': cmp = a.repo.localeCompare(b.repo); break
        case 'version': cmp = (a.version ?? '').localeCompare(b.version ?? ''); break
        case 'date': cmp = a.date.getTime() - b.date.getTime(); break
        case 'status': cmp = (a.success ? 1 : 0) - (b.success ? 1 : 0); break
      }
      return sortAsc ? cmp : -cmp
    })

    return merged
  }, [builds, qas, branches, search, statusFilter, sortColumn, sortAsc])

  const passCount = rows.filter(r => r.success).length

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            {columns.map(col => (
              <th key={col.key} onClick={() => toggleSort(col.key)}>
                {col.label}
                {sortColumn === col.key && (
                  <span className="sort-arrow">{sortAsc ? '\u25B2' : '\u25BC'}</span>
                )}
              </th>
            ))}
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <BuildRow
              key={row.repo}
              row={row}
              expanded={expandedRow === row.repo}
              onToggle={onToggle}
            />
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="empty">No matching IGs</td></tr>
          )}
        </tbody>
      </table>
      <div className="table-footer">
        {rows.length} IGs &middot; {passCount} passing &middot; {rows.length - passCount} failing
      </div>
    </div>
  )
}
