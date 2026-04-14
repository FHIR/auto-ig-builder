// @ts-ignore — Bun import attribute to get raw file text
import typesSource from '../types.ts' with { type: 'text' }
import { useState, useRef } from 'react'

export function LLMPromptButton() {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleCopy = () => {
    const baseUrl = window.location.origin + window.location.pathname
    const prompt = buildPrompt(baseUrl)
    navigator.clipboard.writeText(prompt)
    setCopied(true)
    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button className="link-btn prompt-btn" onClick={handleCopy} title="Copy a prompt for an LLM to help you create a custom view">
      {copied ? 'Copied!' : 'Copy LLM customization prompt'}
    </button>
  )
}

function buildPrompt(baseUrl: string): string {
  return `You are helping a user configure a custom view for the FHIR IG Builds Dashboard.

## About the Dashboard

The dashboard displays build results for FHIR Implementation Guides (IGs) from build.fhir.org. It fetches data from two sources:
- \`builds.json\`: lists all branches across all repos with pass/fail status
- \`qas.json\`: QA results with dates, versions, and error details per branch

The dashboard is configured by a **ViewConfig** JSON object that controls:
- How data is grouped (by repo, by organization, or flat list)
- How groups and branches are sorted
- Which branches are shown (all, only recent, only failing, only master/main)
- Time window for "recent" filtering
- Which UI controls are visible to the user
- Status filtering (all, passing only, failing only)

## ViewConfig TypeScript Schema

\`\`\`typescript
${typesSource}
\`\`\`

## Field Reference

### \`id\` (string)
A URL-safe identifier for this view. Use kebab-case, e.g. \`"my-custom-view"\`.

### \`label\` (string)
Short display name shown in the preset selector, e.g. \`"My View"\`.

### \`description\` (string)
Tooltip text explaining what this view shows.

### \`groupBy\`
- \`"repo"\`: Group branches under their repository (org/repo headers)
- \`"org"\`: Group by GitHub organization, then by repo within each org
- \`"none"\`: Flat list of all branches, each row shows the repo name

### \`groupSort\` / \`groupSortDir\`
How to order the groups:
- \`"activity"\`: Most/least recently updated groups first
- \`"name"\`: Alphabetical by group key
- \`"failCount"\`: Groups with most/fewest failing branches first
Direction: \`"asc"\` or \`"desc"\`

### \`branchSort\` / \`branchSortDir\`
How to order branches within each group (or globally in flat mode):
- \`"date"\`: By last build date
- \`"name"\`: Alphabetical by branch name
- \`"status"\`: Failing branches first (or last)
Direction: \`"asc"\` or \`"desc"\`

### \`branchFilter\`
Which branches to include:
- \`"all"\`: Every branch
- \`"recent"\`: Only branches with activity within \`timeWindowDays\`
- \`"failing"\`: Only branches with build failures
- \`"master"\`: Only branches named \`master\` or \`main\`

### \`timeWindowDays\` (number)
Number of days for the "recent" filter and for filtering which repos appear at all.

### \`statusFilter\`
- \`"all"\`: Show all branches
- \`"success"\`: Only passing branches
- \`"failure"\`: Only failing branches

### \`controls\`
Which UI controls to show:
- \`search\`: Text filter for repo names
- \`statusFilter\`: All/Passing/Failing toggle
- \`timeWindow\`: Time window selector (1d, 1w, 2w, 1m, 3m, 1y)

## Examples of Built-in Presets

1. **Recent Activity**: \`groupBy:"repo", branchFilter:"recent", timeWindowDays:14\` — Default view showing repos with recent builds
2. **Failing Branches**: \`groupBy:"repo", branchFilter:"failing", statusFilter:"failure"\` — Focus on what's broken
3. **By Organization**: \`groupBy:"org", branchFilter:"recent"\` — See all repos organized by their GitHub org
4. **Master/Main Status**: \`groupBy:"none", branchFilter:"master"\` — Quick overview of default branch health
5. **All Branches**: \`groupBy:"none", branchFilter:"all"\` — Everything in one flat list

## Your Task

Help the user design a custom ViewConfig. Ask them what they want to see, then generate the JSON.

When you have the final ViewConfig JSON, create a link like this:

${baseUrl}?view=<URL-encoded JSON without whitespace>

For example:
${baseUrl}?view=${encodeURIComponent(JSON.stringify({id:"example",label:"Example",description:"Example view",groupBy:"repo",groupSort:"activity",groupSortDir:"desc",branchSort:"date",branchSortDir:"desc",branchFilter:"recent",timeWindowDays:14,statusFilter:"all",controls:{search:true,statusFilter:true,timeWindow:true}}))}

Give the user the link so they can click it to load their custom view. Tell them they can bookmark it for future use.

Now ask the user what kind of view they'd like to create.`
}
