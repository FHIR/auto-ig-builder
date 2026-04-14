import { create } from 'zustand'
import type { Build, QA, BranchInfo, ViewConfig } from './types'
import { loadPresets, savePresets, resetPresets, getPreset, normalizeConfig, BUILT_IN_PRESETS } from './presets'

interface Store {
  branches: Record<string, BranchInfo>
  builds: Build[]
  qas: QA[]

  branchesLoaded: boolean
  buildsJsonFetched: boolean
  buildsLoaded: boolean
  qasLoaded: boolean
  buildProgress: { done: number; total: number }

  // View config
  viewConfig: ViewConfig
  presets: ViewConfig[]
  search: string
  expandedRepos: Set<string>

  // Data actions
  setBranches: (branches: Record<string, BranchInfo>) => void
  setBuildsJsonFetched: () => void
  setBuilds: (builds: Build[]) => void
  setQas: (qas: QA[]) => void
  setBuildProgress: (done: number, total: number) => void

  // View actions
  setViewConfig: (id: string) => void
  setViewConfigDirect: (config: ViewConfig) => void
  patchViewConfig: (patch: Partial<ViewConfig>) => void
  setSearch: (search: string) => void
  toggleRepoExpanded: (repo: string) => void

  // Preset management
  savePreset: (config: ViewConfig) => void
  deletePreset: (id: string) => void
  resetPresets: () => void
}

const initialPresets = loadPresets()

export const useStore = create<Store>((set, get) => ({
  branches: {},
  builds: [],
  qas: [],
  branchesLoaded: false,
  buildsJsonFetched: false,
  buildsLoaded: false,
  qasLoaded: false,
  buildProgress: { done: 0, total: 0 },
  viewConfig: initialPresets[0],
  presets: initialPresets,
  search: '',
  expandedRepos: new Set(),

  setBranches: (branches) => set({ branches, branchesLoaded: true }),
  setBuildsJsonFetched: () => set({ buildsJsonFetched: true }),
  setBuilds: (builds) => set({ builds, buildsLoaded: true }),
  setQas: (qas) => set({ qas, qasLoaded: true }),
  setBuildProgress: (done, total) => set({ buildProgress: { done, total } }),

  setViewConfig: (id) => {
    const presets = get().presets
    set({ viewConfig: getPreset(id, presets), expandedRepos: new Set() })
  },
  setViewConfigDirect: (config) => set({ viewConfig: config, expandedRepos: new Set() }),
  patchViewConfig: (patch) => set({ viewConfig: { ...get().viewConfig, ...patch } }),
  setSearch: (search) => set({ search }),
  toggleRepoExpanded: (repo) => {
    const next = new Set(get().expandedRepos)
    if (next.has(repo)) next.delete(repo)
    else next.add(repo)
    set({ expandedRepos: next })
  },

  savePreset: (config) => {
    const presets = get().presets
    const existing = presets.findIndex(p => p.id === config.id)
    const next = existing >= 0
      ? presets.map((p, i) => i === existing ? config : p)
      : [...presets, config]
    savePresets(next)
    set({ presets: next, viewConfig: config })
  },
  deletePreset: (id) => {
    const presets = get().presets.filter(p => p.id !== id)
    if (presets.length === 0) presets.push(...BUILT_IN_PRESETS)
    savePresets(presets)
    const viewConfig = get().viewConfig.id === id ? presets[0] : get().viewConfig
    set({ presets, viewConfig })
  },
  resetPresets: () => {
    const presets = resetPresets()
    set({ presets, viewConfig: presets[0] })
  },
}))
