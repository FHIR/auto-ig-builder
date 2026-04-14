import { memo } from 'react'
import { StatusBadge } from './StatusBadge'
import { RebuildDropdown } from './RebuildDropdown'
import { timeago } from '../timeago'
import type { MergedRow } from '../types'

interface Props {
  row: MergedRow
  expanded: boolean
  onToggle: (repo: string) => void
}

export const BuildRow = memo(function BuildRow({ row, expanded, onToggle }: Props) {
  return (
    <>
      <tr>
        <td className="expand-cell">
          <button className="expand-btn" onClick={() => onToggle(row.repo)} aria-label="Toggle details">
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        </td>
        <td className="repo-cell">
          <a
            href={`https://build.fhir.org/ig/${row.org}/${row.repoName}`}
            target="_blank"
            rel="noopener"
          >
            <span className="org">{row.org}</span>/<span className="name">{row.repoName}</span>
          </a>
        </td>
        <td className="version-cell">{row.version ?? '\u2014'}</td>
        <td className="date-cell" title={row.date?.toISOString()}>
          {row.date.getTime() > 0 ? timeago(row.date) : '\u2014'}
        </td>
        <td className="status-cell"><StatusBadge success={row.success} /></td>
        <td className="links-cell">
          <div className="link-btns">
            <RebuildDropdown org={row.org} repo={row.repoName} branches={row.branches} />
            <a className="link-btn" href={`https://build.fhir.org/ig/${row.org}/${row.repoName}/branches/__default/${row.success ? '' : 'failure/'}build.log`} target="_blank" rel="noopener">log</a>
            <a className="link-btn" href={`https://github.com/${row.org}/${row.repoName}`} target="_blank" rel="noopener">gh</a>
            <a className="link-btn" href={`https://build.fhir.org/ig/${row.org}/${row.repoName}/branches/__default/${row.success ? '' : 'failure/output/'}qa.html`} target="_blank" rel="noopener">qa</a>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={6}>
            <div className="detail-grid">
              {row.build && (
                <div>
                  <h4>Build</h4>
                  <pre>{JSON.stringify(row.build, null, 2)}</pre>
                </div>
              )}
              {row.qa && (
                <div>
                  <h4>QA</h4>
                  <pre>{JSON.stringify(row.qa, null, 2)}</pre>
                </div>
              )}
            </div>
            <div className="branch-list">
              {row.branches.map(b => (
                <span key={b.name} className={`branch-tag${b.failing ? ' failing' : ''}`}>
                  {b.name}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
})
