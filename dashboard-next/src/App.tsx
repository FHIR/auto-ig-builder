import { useEffect } from 'react'
import { initData } from './api'
import { FilterBar } from './components/FilterBar'
import { BuildTable } from './components/BuildTable'
import { LLMPromptButton } from './components/LLMPromptButton'
import { useStore } from './store'
import { normalizeConfig } from './presets'

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
          {qasLoaded ? 'QA data loaded' : 'Fetching QA data…'}
        </span>
        <span>
          <span className={`dot ${buildsLoaded ? 'dot-done' : 'dot-loading'}`} />
          {!buildsJsonFetched ? 'Fetching builds index…'
            : !branchesLoaded ? 'Parsing branches…'
            : total > 0 ? `Scraping build pages ${done}/${total}`
            : 'Starting build scrapes…'}
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

  // Hydrate from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('q')
    if (q) useStore.getState().setSearch(q)

    const viewParam = params.get('view')
    if (viewParam) {
      // Check if it's a known preset id
      const presets = useStore.getState().presets
      const preset = presets.find(p => p.id === viewParam)
      if (preset) {
        useStore.getState().setViewConfig(viewParam)
      } else {
        // Try parsing as JSON config
        try {
          const parsed = JSON.parse(viewParam)
          if (parsed && typeof parsed === 'object' && parsed.groupBy) {
            useStore.getState().setViewConfigDirect(normalizeConfig(parsed))
          }
        } catch {}
      }
    }
  }, [])

  // Sync to URL
  useEffect(() => {
    let prevSearch = ''
    let prevConfigJson = ''
    return useStore.subscribe(state => {
      const configJson = JSON.stringify(state.viewConfig)
      if (state.search === prevSearch && configJson === prevConfigJson) return
      prevSearch = state.search
      prevConfigJson = configJson

      const params = new URLSearchParams()
      if (state.search) params.set('q', state.search)

      // Always serialize the full config so URLs are self-contained and shareable
      params.set('view', JSON.stringify(state.viewConfig))

      const qs = params.toString()
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
    })
  }, [])

  const branchesLoaded = useStore(s => s.branchesLoaded)
  const qasLoaded = useStore(s => s.qasLoaded)

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <h1>FHIR CI-Build</h1>
          <LLMPromptButton />
        </div>
      </header>
      <div className="container">
        <LoadingStatus />
        <FilterBar />
        {(branchesLoaded || qasLoaded) ? (
          <BuildTable />
        ) : (
          <div className="empty">Loading…</div>
        )}
      </div>
    </>
  )
}
