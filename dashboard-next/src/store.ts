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
  sortColumn: SortColumn
  sortAsc: boolean
  expandedRow: string | null

  setBranches: (branches: Record<string, BranchInfo>) => void
  setBuildsJsonFetched: () => void
  setBuilds: (builds: Build[]) => void
  setQas: (qas: QA[]) => void
  setSearch: (search: string) => void
  setStatusFilter: (filter: StatusFilter) => void
  toggleSort: (column: SortColumn) => void
  toggleExpanded: (repo: string) => void
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
  sortColumn: 'date',
  sortAsc: false,
  expandedRow: null,

  setBranches: (branches) => set({ branches, branchesLoaded: true }),
  setBuildsJsonFetched: () => set({ buildsJsonFetched: true }),
  setBuilds: (builds) => set({ builds, buildsLoaded: true }),
  setQas: (qas) => set({ qas, qasLoaded: true }),
  setSearch: (search) => set({ search }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  toggleSort: (column) => {
    const { sortColumn, sortAsc } = get()
    if (sortColumn === column) {
      set({ sortAsc: !sortAsc })
    } else {
      set({ sortColumn: column, sortAsc: column === 'repo' })
    }
  },
  toggleExpanded: (repo) => {
    set({ expandedRow: get().expandedRow === repo ? null : repo })
  },
  setBuildProgress: (done, total) => set({ buildProgress: { done, total } }),
}))
