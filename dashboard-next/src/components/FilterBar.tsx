import { useState } from 'react'
import { useStore } from '../store'
import { BUILT_IN_PRESETS } from '../presets'
import type { StatusFilter } from '../types'

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Passing' },
  { value: 'failure', label: 'Failing' },
]

const timeWindows: { days: number; label: string }[] = [
  { days: 1, label: '1d' },
  { days: 7, label: '1w' },
  { days: 14, label: '2w' },
  { days: 30, label: '1m' },
  { days: 90, label: '3m' },
  { days: 365, label: '1y' },
]

export function FilterBar() {
  const viewConfig = useStore(s => s.viewConfig)
  const presets = useStore(s => s.presets)
  const search = useStore(s => s.search)
  const setViewConfig = useStore(s => s.setViewConfig)
  const patchViewConfig = useStore(s => s.patchViewConfig)
  const setSearch = useStore(s => s.setSearch)
  const savePreset = useStore(s => s.savePreset)
  const deletePreset = useStore(s => s.deletePreset)
  const resetPresetsAction = useStore(s => s.resetPresets)

  const [detailsOpen, setDetailsOpen] = useState(false)

  const isBuiltIn = BUILT_IN_PRESETS.some(p => p.id === viewConfig.id)
  const isSaved = presets.some(p => p.id === viewConfig.id)
  const isModified = isSaved && presets.some(p => p.id === viewConfig.id && (
    p.statusFilter !== viewConfig.statusFilter ||
    p.timeWindowDays !== viewConfig.timeWindowDays
  ))

  return (
    <div className="filter-bar-wrap">
      <div className="preset-bar">
        {presets.map(p => (
          <span key={p.id} className="preset-btn-wrap">
            <button
              className={`preset-btn${viewConfig.id === p.id ? ' active' : ''}`}
              onClick={() => setViewConfig(p.id)}
              title={p.description}
            >
              {p.label}
            </button>
            {!BUILT_IN_PRESETS.some(bp => bp.id === p.id) && (
              <button
                className="preset-delete"
                onClick={(e) => { e.stopPropagation(); deletePreset(p.id) }}
                title="Remove this view"
              >&times;</button>
            )}
          </span>
        ))}
        {!isSaved && (
          <button className="preset-btn save-btn" onClick={() => savePreset(viewConfig)}>
            + Save view
          </button>
        )}
        {presets.length > BUILT_IN_PRESETS.length && (
          <button className="preset-btn reset-btn" onClick={resetPresetsAction} title="Reset to built-in views only">
            Reset
          </button>
        )}
      </div>

      <div className="view-info">
        <div className="view-info-header">
          <strong className="view-label">{viewConfig.label}</strong>
          <button className="view-desc-toggle" onClick={() => setDetailsOpen(!detailsOpen)}>
            {detailsOpen ? 'hide details' : 'view details'}
          </button>
        </div>
        {detailsOpen && (
          <div className="view-details">
            {viewConfig.description && <p className="view-desc">{viewConfig.description}</p>}
            <pre className="view-json">{JSON.stringify(viewConfig, null, 2)}</pre>
          </div>
        )}
      </div>

      <div className="filter-bar">
        {viewConfig.controls.search && (
          <input
            className="filter-input"
            placeholder="Filter IGs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}
        {viewConfig.controls.statusFilter && (
          <div className="toggle-group">
            {statusFilters.map(f => (
              <button
                key={f.value}
                className={`toggle-btn${viewConfig.statusFilter === f.value ? ' active' : ''}`}
                onClick={() => patchViewConfig({ statusFilter: f.value })}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {viewConfig.controls.timeWindow && (
          <div className="toggle-group">
            {timeWindows.map(tw => (
              <button
                key={tw.days}
                className={`toggle-btn${viewConfig.timeWindowDays === tw.days ? ' active' : ''}`}
                onClick={() => patchViewConfig({ timeWindowDays: tw.days })}
              >
                {tw.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
