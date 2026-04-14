export interface Branch {
  name: string
  failing: boolean
}

export interface BranchInfo {
  branches: Branch[]
}

export interface Build {
  repo: string
  master: boolean
  failure: boolean
  date: Date | null
  version: string | null
}

export interface QA {
  repo: string
  master: boolean
  failure: boolean
  date: Date
  version?: string
  exception?: boolean
  [key: string]: unknown
}

export interface MergedRow {
  org: string
  repoName: string
  repo: string
  date: Date
  version: string | null
  success: boolean
  build: Build | undefined
  qa: QA | undefined
  branches: Branch[]
}

export type SortColumn = 'repo' | 'version' | 'date' | 'status'
export type StatusFilter = 'all' | 'success' | 'failure'
