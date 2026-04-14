import { create } from 'zustand'
import type { Build, QA, BranchInfo, SortColumn, StatusFilter } from './types'

interface Store {
  branches: Record<string, BranchInfo>
  builds: Build[]
  qas: QA[]

  branchesLoaded: boolean
  buildsJsonFetched: boolean
  buildsLoaded: boolean
  qasLoaded: boolean
  buildProgress: { done: number; total: number }

  search: string
  statusFilter: StatusFilter
  timeWindowDays: number
  sortColumn: SortColumn
  sortAsc: boolean
  expandedRepos: Set<string>

  setBranches: (branches: Record<string, BranchInfo>) => void
  setBuildsJsonFetched: () => void
  setBuilds: (builds: Build[]) => void
  setQas: (qas: QA[]) => void
  setSearch: (search: string) => void
  setStatusFilter: (filter: StatusFilter) => void
  setTimeWindowDays: (days: number) => void
  toggleSort: (column: SortColumn) => void
  toggleRepoExpanded: (repo: string) => void
  setBuildProgress: (done: number, total: number) => void
}

export const useStore = create<Store>((set, get) => ({
  branches: {},
  builds: [],
  qas: [],
  branchesLoaded: false,
  buildsJsonFetched: false,
  buildsLoaded: false,
  qasLoaded: false,
  buildProgress: { done: 0, total: 0 },
  search: '',
  statusFilter: 'all',
  timeWindowDays: 14,
  sortColumn: 'date',
  sortAsc: false,
  expandedRepos: new Set(),

  setBranches: (branches) => set({ branches, branchesLoaded: true }),
  setBuildsJsonFetched: () => set({ buildsJsonFetched: true }),
  setBuilds: (builds) => set({ builds, buildsLoaded: true }),
  setQas: (qas) => set({ qas, qasLoaded: true }),
  setSearch: (search) => set({ search }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setTimeWindowDays: (days) => set({ timeWindowDays: days }),
  toggleSort: (column) => {
    const { sortColumn, sortAsc } = get()
    if (sortColumn === column) {
      set({ sortAsc: !sortAsc })
    } else {
      set({ sortColumn: column, sortAsc: column === 'repo' })
    }
  },
  toggleRepoExpanded: (repo) => {
    const next = new Set(get().expandedRepos)
    if (next.has(repo)) next.delete(repo)
    else next.add(repo)
    set({ expandedRepos: next })
  },
  setBuildProgress: (done, total) => set({ buildProgress: { done, total } }),
}))
