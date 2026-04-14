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
  branch: string
  master: boolean
  failure: boolean
  date: Date
  version?: string
  exception?: boolean
  [key: string]: unknown
}

export interface BranchRow {
  branch: string
  date: Date
  version: string | null
  failing: boolean
  qa: QA | undefined
}

export interface RepoGroup {
  repo: string
  org: string
  repoName: string
  latestDate: Date
  branches: BranchRow[]
}

export type SortColumn = 'repo' | 'version' | 'date' | 'status'
export type StatusFilter = 'all' | 'success' | 'failure'
