import { useEffect } from 'react'
import { initData } from './api'
import { FilterBar } from './components/FilterBar'
import { BuildTable } from './components/BuildTable'
import { useStore } from './store'
import type { StatusFilter, SortColumn } from './types'

function LoadingStatus() {
  const buildsJsonFetched = useStore(s => s.buildsJsonFetched)
  const branchesLoaded = useStore(s => s.branchesLoaded)
  const buildsLoaded = useStore(s => s.buildsLoaded)
  const qasLoaded = useStore(s => s.qasLoaded)
  const { done, total } = useStore(s => s.buildProgress)

  if (buildsLoaded && qasLoaded) return null

  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="loading-panel">
      <div className="loading-row">
        <span>
          <span className={`dot ${qasLoaded ? 'dot-done' : 'dot-loading'}`} />
          {qasLoaded ? 'QA data loaded' : 'Fetching QA data\u2026'}
        </span>
        <span>
          <span className={`dot ${buildsLoaded ? 'dot-done' : 'dot-loading'}`} />
          {!buildsJsonFetched ? 'Fetching builds index\u2026'
            : !branchesLoaded ? 'Parsing branches\u2026'
            : total > 0 ? `Scraping build pages ${done}/${total}`
            : 'Starting build scrapes\u2026'}
        </span>
      </div>
      {total > 0 && !buildsLoaded && (
        <div className="loading-bar">
          <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function App() {
  useEffect(() => { initData() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('q')
    const status = params.get('status')
    const sort = params.get('sort')
    const asc = params.get('asc')
    if (q) useStore.getState().setSearch(q)
    if (status && ['all', 'success', 'failure'].includes(status))
      useStore.getState().setStatusFilter(status as StatusFilter)
    if (sort && ['repo', 'version', 'date', 'status'].includes(sort))
      useStore.setState({ sortColumn: sort as SortColumn, sortAsc: asc === '1' })
  }, [])

  useEffect(() => {
    let prev = { search: '', statusFilter: 'all' as StatusFilter, sortColumn: 'date' as SortColumn, sortAsc: false }
    return useStore.subscribe(state => {
      const cur = { search: state.search, statusFilter: state.statusFilter, sortColumn: state.sortColumn, sortAsc: state.sortAsc }
      if (cur.search === prev.search && cur.statusFilter === prev.statusFilter && cur.sortColumn === prev.sortColumn && cur.sortAsc === prev.sortAsc) return
      prev = cur
      const params = new URLSearchParams()
      if (cur.search) params.set('q', cur.search)
      if (cur.statusFilter !== 'all') params.set('status', cur.statusFilter)
      if (cur.sortColumn !== 'date' || cur.sortAsc) {
        params.set('sort', cur.sortColumn)
        if (cur.sortAsc) params.set('asc', '1')
      }
      const qs = params.toString()
      window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
    })
  }, [])

  const branchesLoaded = useStore(s => s.branchesLoaded)
  const qasLoaded = useStore(s => s.qasLoaded)

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <h1>FHIR IG Builds</h1>
          <span className="subtitle">build.fhir.org</span>
        </div>
      </header>
      <div className="container">
        <LoadingStatus />
        <FilterBar />
        {(branchesLoaded || qasLoaded) ? (
          <BuildTable />
        ) : (
          <div className="empty">Loading\u2026</div>
        )}
      </div>
    </>
  )
}
