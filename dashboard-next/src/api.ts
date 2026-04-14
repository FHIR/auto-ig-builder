import { useStore } from './store'
import type { Build, QA, BranchInfo, Branch } from './types'

// ---------- async pool (preserves original concurrency limiter) ----------

function asyncPool(parallel = 6) {
  let inFlight = 0
  const pending: { args: [string]; resolve: (v: Response) => void; reject: (e: unknown) => void }[] = []

  const tryProgress = () => {
    while (inFlight < parallel) {
      const next = pending.shift()
      if (!next) break
      inFlight++
      fetch(...next.args)
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          inFlight--
          tryProgress()
        })
    }
  }

  return function (url: string): Promise<Response> {
    return new Promise((resolve, reject) => {
      pending.push({ args: [url], resolve, reject })
      tryProgress()
    })
  }
}

// ---------- parse builds.json into branch map ----------

function parseBranches(builds: string[]): Record<string, BranchInfo> {
  const entries = builds.map(entry => {
    const parts = entry.split('/')
    return {
      org: parts[0],
      repo: parts[1],
      branch: parts[3],
      failure: parts.includes('failure'),
    }
  })

  const grouped: Record<string, typeof entries> = {}
  for (const e of entries) {
    const key = `${e.org}/${e.repo}`;
    (grouped[key] ??= []).push(e)
  }

  const result: Record<string, BranchInfo> = {}
  for (const [key, group] of Object.entries(grouped)) {
    const seen = new Set<string>()
    const branches: Branch[] = []
    for (const e of group) {
      if (seen.has(e.branch)) continue
      seen.add(e.branch)
      branches.push({
        name: e.branch,
        failing: group.some(g => g.branch === e.branch && g.failure),
      })
    }
    result[key] = { branches }
  }

  return result
}

// ---------- scrape individual build pages for date/version ----------

async function fetchBuilds(builds: string[]): Promise<Build[]> {
  const fetchPool = asyncPool(24)
  const masterBuilds = builds.filter(repo => /\/master|main\//.test(repo))
  const { setBuildProgress } = useStore.getState()
  const total = masterBuilds.length
  setBuildProgress(0, total)
  let done = 0
  let lastReported = 0

  return Promise.all(
    masterBuilds.map(repo =>
      fetchPool('https://build.fhir.org/ig/' + repo.replace('#', '%23'))
        .then(b => b.text())
        .then(b => {
          done++
          // Throttle progress updates: report every 2% or every 10 completions
          if (done === total || done - lastReported >= Math.max(10, Math.floor(total / 50))) {
            lastReported = done
            setBuildProgress(done, total)
          }

          const dateMatch = b.match(/Coordinated Universal Time \((.*?)\)/)
          const versionMatch = b.match(/Definitions (\S+)/)

          let date: Date | null = dateMatch ? new Date(dateMatch[1]) : null
          if (date && isNaN(date.getTime())) date = null

          return {
            repo: repo.split('/').slice(0, 2).join('/'),
            master: true,
            failure: /\/failure\//.test(repo),
            date,
            version: versionMatch?.[1] ?? null,
          }
        })
    )
  )
}

// ---------- parse qas.json ----------

function parseQas(raw: Record<string, unknown>[]): QA[] {
  return raw.map(qa => ({
    ...qa,
    date: new Date(qa.date as string),
    master: /\/master\//.test(qa.repo as string),
    failure: /\/failure\//.test(qa.repo as string),
    repo: (qa.repo as string).split('/').slice(0, 2).join('/'),
  })) as QA[]
}

// ---------- kick off both parallel fetch paths ----------

export function initData() {
  const store = useStore.getState()

  // Path A: builds.json → branches (fast) → scrape each build page (slow)
  fetch('https://build.fhir.org/ig/builds.json')
    .then(r => r.json())
    .then((builds: string[]) => {
      store.setBuildsJsonFetched()
      const branches = parseBranches(builds)
      store.setBranches(branches)
      return builds
    })
    .then(builds => fetchBuilds(builds))
    .then(builds => store.setBuilds(builds))

  // Path B: qas.json → parse (fast)
  fetch('https://build.fhir.org/ig/qas.json')
    .then(r => r.json())
    .then(parseQas)
    .then(qas => store.setQas(qas))
}
