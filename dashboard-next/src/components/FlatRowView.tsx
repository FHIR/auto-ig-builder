import { memo, useState } from 'react'
import { StatusBadge } from './StatusBadge'
import { timeago } from '../timeago'
import { triggerRebuild, isRebuilt } from '../rebuild'
import type { FlatRow } from '../types'

export const FlatRowView = memo(function FlatRowView({ row }: { row: FlatRow }) {
  const { org, repoName, branch: b } = row
  const [rebuilding, setRebuilding] = useState(false)

  const handleRebuild = () => {
    if (triggerRebuild(org, repoName, b.branch)) {
      setRebuilding(true)
    }
  }

  const rebuilt = rebuilding || isRebuilt(org, repoName, b.branch)
  const branchPath = b.branch === 'master' || b.branch === 'main' ? '__default' : b.branch
  const failPrefix = b.failing ? 'failure/' : ''

  return (
    <tr className="branch-row">
      <td className="repo-cell">
        <a href={`https://build.fhir.org/ig/${org}/${repoName}`} target="_blank" rel="noopener">
          <span className="org">{org}</span>/<span className="name">{repoName}</span>
        </a>
      </td>
      <td className="branch-name-cell">
        <a href={`https://build.fhir.org/ig/${org}/${repoName}/branches/${branchPath}/`} target="_blank" rel="noopener">{b.branch}</a>
      </td>
      <td className="version-cell">{b.version ?? '\u2014'}</td>
      <td className="date-cell" title={b.date?.toISOString()}>
        {b.date.getTime() > 0 ? timeago(b.date) : '\u2014'}
      </td>
      <td className="status-cell"><StatusBadge success={!b.failing} /></td>
      <td className="links-cell">
        <div className="link-btns">
          <a className="link-btn" href={`https://build.fhir.org/ig/${org}/${repoName}/branches/${branchPath}/${failPrefix}build.log`} target="_blank" rel="noopener">log</a>
          <a className="link-btn" href={`https://build.fhir.org/ig/${org}/${repoName}/branches/${branchPath}/${failPrefix}${b.failing ? 'output/' : ''}qa.html`} target="_blank" rel="noopener">qa</a>
          <button className={`link-btn${rebuilt ? ' rebuilt' : ''}`} onClick={handleRebuild} disabled={rebuilt}>
            {rebuilt ? 'sent' : 'rebuild'}
          </button>
        </div>
      </td>
    </tr>
  )
})
