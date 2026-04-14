import { memo, useState } from 'react'
import { StatusBadge } from './StatusBadge'
import { timeago } from '../timeago'
import { triggerRebuild, isRebuilt } from '../rebuild'
import type { ViewGroup, BranchRow } from '../types'

interface Props {
  group: ViewGroup
  expanded: boolean
  onToggle: (repo: string) => void
  orgHeader?: string
}

export const RepoGroupView = memo(function RepoGroupView({ group, expanded, onToggle, orgHeader }: Props) {
  const branches = expanded ? group.allBranches : group.visibleBranches
  const hiddenCount = expanded ? 0 : group.hiddenCount

  return (
    <>
      {orgHeader && (
        <tr className="org-header">
          <td colSpan={5}>{orgHeader}</td>
        </tr>
      )}
      <tr className="group-header">
        <td colSpan={5}>
          <a href={`https://build.fhir.org/ig/${group.org}/${group.repoName}`} target="_blank" rel="noopener">
            <span className="org">{group.org}</span>/<span className="name">{group.repoName}</span>
          </a>
          <span className="group-meta">
            {group.allBranches.length} branch{group.allBranches.length !== 1 ? 'es' : ''}
          </span>
          <a className="link-btn group-link" href={`https://github.com/${group.org}/${group.repoName}`} target="_blank" rel="noopener">gh</a>
        </td>
      </tr>
      {branches.map(b => (
        <BranchRowView key={b.branch} branch={b} org={group.org} repoName={group.repoName} />
      ))}
      {hiddenCount > 0 && (
        <tr className="show-more-row">
          <td colSpan={5}>
            <button className="show-more-btn" onClick={() => onToggle(group.repo)}>
              show {hiddenCount} more branch{hiddenCount !== 1 ? 'es' : ''}
            </button>
          </td>
        </tr>
      )}
      {expanded && group.hiddenCount > 0 && (
        <tr className="show-more-row">
          <td colSpan={5}>
            <button className="show-more-btn" onClick={() => onToggle(group.repo)}>
              hide extra branches
            </button>
          </td>
        </tr>
      )}
      {branches.length === 0 && hiddenCount > 0 && (
        <tr className="show-more-row">
          <td colSpan={5}>
            <span className="no-recent">no matching branches &mdash; </span>
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
          <button className={`link-btn${rebuilt ? ' rebuilt' : ''}`} onClick={handleRebuild} disabled={rebuilt}>
            {rebuilt ? 'sent' : 'rebuild'}
          </button>
        </div>
      </td>
    </tr>
  )
})
