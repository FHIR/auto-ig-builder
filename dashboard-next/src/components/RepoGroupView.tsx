import { memo } from 'react'
import { StatusBadge } from './StatusBadge'
import { timeago } from '../timeago'
import { triggerRebuild, isRebuilt } from '../rebuild'
import type { RepoGroup, BranchRow, StatusFilter } from '../types'
import { useState } from 'react'

interface Props {
  group: RepoGroup
  expanded: boolean
  onToggle: (repo: string) => void
  cutoff: Date
  statusFilter: StatusFilter
}

export const RepoGroupView = memo(function RepoGroupView({ group, expanded, onToggle, cutoff, statusFilter }: Props) {
  // Filter branches: status filter always applies; time filter unless expanded
  const filteredBranches = group.branches.filter(b => {
    if (statusFilter === 'success' && b.failing) return false
    if (statusFilter === 'failure' && !b.failing) return false
    return true
  })

  const recentBranches = filteredBranches.filter(b => b.date.getTime() > cutoff.getTime())
  const visibleBranches = expanded ? filteredBranches : recentBranches
  const hiddenCount = filteredBranches.length - recentBranches.length

  return (
    <>
      <tr className="group-header">
        <td colSpan={5}>
          <a href={`https://build.fhir.org/ig/${group.org}/${group.repoName}`} target="_blank" rel="noopener">
            <span className="org">{group.org}</span>/<span className="name">{group.repoName}</span>
          </a>
          <span className="group-meta">
            {group.branches.length} branch{group.branches.length !== 1 ? 'es' : ''}
          </span>
          <a className="link-btn group-link" href={`https://github.com/${group.org}/${group.repoName}`} target="_blank" rel="noopener">gh</a>
        </td>
      </tr>
      {visibleBranches.map(b => (
        <BranchRowView key={b.branch} branch={b} org={group.org} repoName={group.repoName} />
      ))}
      {!expanded && hiddenCount > 0 && (
        <tr className="show-more-row">
          <td colSpan={5}>
            <button className="show-more-btn" onClick={() => onToggle(group.repo)}>
              show {hiddenCount} older branch{hiddenCount !== 1 ? 'es' : ''}
            </button>
          </td>
        </tr>
      )}
      {expanded && hiddenCount > 0 && (
        <tr className="show-more-row">
          <td colSpan={5}>
            <button className="show-more-btn" onClick={() => onToggle(group.repo)}>
              hide older branches
            </button>
          </td>
        </tr>
      )}
      {visibleBranches.length === 0 && !expanded && hiddenCount > 0 && (
        <tr className="show-more-row">
          <td colSpan={5}>
            <span className="no-recent">no recent activity &mdash; </span>
            <button className="show-more-btn" onClick={() => onToggle(group.repo)}>
              show {hiddenCount} branch{hiddenCount !== 1 ? 'es' : ''}
            </button>
          </td>
        </tr>
      )}
    </>
  )
})

const BranchRowView = memo(function BranchRowView({ branch: b, org, repoName }: { branch: BranchRow; org: string; repoName: string }) {
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
          <a className="link-btn" href={`https://build.fhir.org/ig/${org}/${repoName}/branches/${branchPath}/`} target="_blank" rel="noopener">build</a>
          <button className={`link-btn${rebuilt ? ' rebuilt' : ''}`} onClick={handleRebuild} disabled={rebuilt}>
            {rebuilt ? 'sent' : 'rebuild'}
          </button>
        </div>
      </td>
    </tr>
  )
})
