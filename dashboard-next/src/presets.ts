import type { ViewConfig } from './types'

export const BUILT_IN_PRESETS: ViewConfig[] = [
  {
    id: 'recent-activity',
    label: 'What\u2019s building right now?',
    description: 'See which repos have had build activity recently, grouped by repository with the most recently active first. Within each repo, only branches with recent activity are shown — expand to see older ones. Adjust the time window to widen or narrow the view.',
    groupBy: 'repo',
    groupSort: 'activity',
    groupSortDir: 'desc',
    branchSort: 'date',
    branchSortDir: 'desc',
    branchFilter: 'recent',
    branchPattern: '',
    repoPattern: '',
    timeWindowDays: 14,
    statusFilter: 'all',
    controls: { search: true, statusFilter: true, timeWindow: true },
  },
  {
    id: 'failing-branches',
    label: 'What\u2019s broken?',
    description: 'Triage build failures across the ecosystem. Shows only branches that are currently failing, grouped by repo with the most-broken repos first. Use this to find and fix problems.',
    groupBy: 'repo',
    groupSort: 'failCount',
    groupSortDir: 'desc',
    branchSort: 'date',
    branchSortDir: 'desc',
    branchFilter: 'failing',
    branchPattern: '',
    repoPattern: '',
    timeWindowDays: 365,
    statusFilter: 'failure',
    controls: { search: true, statusFilter: false, timeWindow: true },
  },
  {
    id: 'by-org',
    label: 'How is my organization doing?',
    description: 'Browse repos grouped by GitHub organization to check build health for a specific org or compare activity across orgs. Recent branches only — expand to see more.',
    groupBy: 'org',
    groupSort: 'name',
    groupSortDir: 'asc',
    branchSort: 'date',
    branchSortDir: 'desc',
    branchFilter: 'recent',
    branchPattern: '',
    repoPattern: '',
    timeWindowDays: 30,
    statusFilter: 'all',
    controls: { search: true, statusFilter: true, timeWindow: true },
  },
  {
    id: 'master-status',
    label: 'Is every IG\u2019s default branch healthy?',
    description: 'Quick health check: shows only the master/main branch of every repo, most recently built first. Use the status filter to zero in on failures.',
    groupBy: 'none',
    groupSort: 'activity',
    groupSortDir: 'desc',
    branchSort: 'date',
    branchSortDir: 'desc',
    branchFilter: 'master',
    branchPattern: '',
    repoPattern: '',
    timeWindowDays: 365,
    statusFilter: 'all',
    controls: { search: true, statusFilter: true, timeWindow: false },
  },
  {
    id: 'all-branches',
    label: 'What just built across everything?',
    description: 'A flat, chronological feed of every branch build across all repos — most recent first. See the global pulse of the build system regardless of repo boundaries.',
    groupBy: 'none',
    groupSort: 'activity',
    groupSortDir: 'desc',
    branchSort: 'date',
    branchSortDir: 'desc',
    branchFilter: 'all',
    branchPattern: '',
    repoPattern: '',
    timeWindowDays: 30,
    statusFilter: 'all',
    controls: { search: true, statusFilter: true, timeWindow: true },
  },
]

const STORAGE_KEY = 'fhir-ig-dashboard-presets'

export function loadPresets(): ViewConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return [...BUILT_IN_PRESETS]
}

export function savePresets(presets: ViewConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

export function resetPresets(): ViewConfig[] {
  localStorage.removeItem(STORAGE_KEY)
  return [...BUILT_IN_PRESETS]
}

export function getPreset(id: string, presets: ViewConfig[]): ViewConfig {
  return presets.find(p => p.id === id) ?? presets[0] ?? BUILT_IN_PRESETS[0]
}

/** Fill in defaults for any missing fields (e.g., from a URL-loaded partial config). */
export function normalizeConfig(partial: Partial<ViewConfig>): ViewConfig {
  const base = BUILT_IN_PRESETS[0]
  return {
    ...base,
    ...partial,
    controls: { ...base.controls, ...(partial.controls ?? {}) },
  }
}
