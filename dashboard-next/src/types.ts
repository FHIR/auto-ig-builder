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

// --- View Configuration ---
// This is the complete language for defining a dashboard view.
// Every aspect of grouping, sorting, filtering, and UI is driven by this config.

export type GroupBy = 'repo' | 'org' | 'none'
export type GroupSort = 'activity' | 'name' | 'failCount' | 'branchCount'
export type BranchSort = 'date' | 'name' | 'status'
export type SortDir = 'asc' | 'desc'
export type StatusFilter = 'all' | 'success' | 'failure'

export interface ViewConfig {
  /** URL-safe identifier for this view (kebab-case). */
  id: string

  /** Display name shown in the preset menu. */
  label: string

  /** Tooltip text describing what this view shows. */
  description: string

  /** How to group rows: by repo, by GitHub org, or flat (no grouping). */
  groupBy: GroupBy

  /** How to sort groups. */
  groupSort: GroupSort

  /** Sort direction for groups. */
  groupSortDir: SortDir

  /** How to sort branches within each group (or globally in flat mode). */
  branchSort: BranchSort

  /** Sort direction for branches. */
  branchSortDir: SortDir

  /** Quick branch filter preset: all, only failing, only master/main, or only recent (within timeWindowDays). */
  branchFilter: 'all' | 'failing' | 'master' | 'recent'

  /** Regex pattern to filter branch names (applied after branchFilter). Empty string means no pattern filter. */
  branchPattern: string

  /** Regex pattern to filter repo names (org/repo). Empty string means no pattern filter. */
  repoPattern: string

  /** Number of days for the "recent" time window. Also controls which repos appear (repos with no activity within this window are hidden when branchFilter is "recent"). */
  timeWindowDays: number

  /** Status filter: show all branches, only passing, or only failing. Composes with branchFilter. */
  statusFilter: StatusFilter

  /** Which UI controls to show for this view. */
  controls: {
    /** Text search box for repo names. */
    search: boolean
    /** All/Passing/Failing toggle. */
    statusFilter: boolean
    /** Time window selector (1d, 1w, 2w, 1m, 3m, 1y). */
    timeWindow: boolean
  }
}

// --- Display types (output of applyView) ---

export interface ViewGroup {
  repo: string
  org: string
  repoName: string
  allBranches: BranchRow[]
  visibleBranches: BranchRow[]
  hiddenCount: number
}

export interface FlatRow {
  org: string
  repoName: string
  repo: string
  branch: BranchRow
}

export type ViewResult = {
  mode: 'grouped'
  groupBy: 'repo' | 'org'
  groups: ViewGroup[]
} | {
  mode: 'flat'
  rows: FlatRow[]
}
