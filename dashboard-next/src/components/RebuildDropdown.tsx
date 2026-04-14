import { useState, useRef, useEffect } from 'react'
import type { Branch } from '../types'
import { triggerRebuild, isRebuilt } from '../rebuild'

interface Props {
  org: string
  repo: string
  branches: Branch[]
}

export function RebuildDropdown({ org, repo, branches }: Props) {
  const [open, setOpen] = useState(false)
  const [triggered, setTriggered] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleRebuild = (branch: string) => {
    if (triggerRebuild(org, repo, branch)) {
      setTriggered(prev => new Set(prev).add(branch))
    }
  }

  return (
    <div className="rebuild-wrap" ref={ref}>
      <button className="link-btn" onClick={() => setOpen(!open)}>
        Rebuild &#9662;
      </button>
      {open && (
        <div className="rebuild-menu">
          {branches.map(b => {
            const done = triggered.has(b.name) || isRebuilt(org, repo, b.name)
            return (
              <button
                key={b.name}
                className={`rebuild-item${b.failing ? ' failing' : ''}${done ? ' done' : ''}`}
                onClick={() => handleRebuild(b.name)}
              >
                {b.name}{b.failing ? ' [failing]' : ''}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
