import { useStore } from '../store'
import type { StatusFilter } from '../types'

const filters: { value: StatusFilter; label: string }[] = [
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
  const search = useStore(s => s.search)
  const statusFilter = useStore(s => s.statusFilter)
  const timeWindowDays = useStore(s => s.timeWindowDays)
  const setSearch = useStore(s => s.setSearch)
  const setStatusFilter = useStore(s => s.setStatusFilter)
  const setTimeWindowDays = useStore(s => s.setTimeWindowDays)

  return (
    <div className="filter-bar">
      <input
        className="filter-input"
        placeholder="Filter IGs…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="toggle-group">
        {filters.map(f => (
          <button
            key={f.value}
            className={`toggle-btn${statusFilter === f.value ? ' active' : ''}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="toggle-group">
        {timeWindows.map(tw => (
          <button
            key={tw.days}
            className={`toggle-btn${timeWindowDays === tw.days ? ' active' : ''}`}
            onClick={() => setTimeWindowDays(tw.days)}
          >
            {tw.label}
          </button>
        ))}
      </div>
    </div>
  )
}
