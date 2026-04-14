import { useStore } from '../store'
import type { StatusFilter } from '../types'

const filters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Passing' },
  { value: 'failure', label: 'Failing' },
]

export function FilterBar() {
  const search = useStore(s => s.search)
  const statusFilter = useStore(s => s.statusFilter)
  const setSearch = useStore(s => s.setSearch)
  const setStatusFilter = useStore(s => s.setStatusFilter)

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
    </div>
  )
}
