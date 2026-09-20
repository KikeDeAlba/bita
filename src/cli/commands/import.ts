import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { createContext } from '../context.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import { resolveDateRange } from '../../domain/date-range.ts'
import { addDays, localDay } from '../../domain/timezone.ts'
import { fetchTimeEntries } from '../../toggl/time-entries.ts'
import type { WireTimeEntry } from '../../toggl/wire-types.ts'
import { openDatabase } from '../../db/open.ts'
import { databasePath } from '../../db/paths.ts'
import { importFromToggl } from '../../db/import-toggl.ts'
import { listProjects } from '../../db/projects.ts'

const IMPORT_EPOCH_DAY = '2020-01-01'
const REPORTS_MAX_SPAN_DAYS = 360

export function importWindows(fromDay: string, toDay: string): { from: string; to: string }[] {
  const windows: { from: string; to: string }[] = []
  let cursor = fromDay
  while (cursor <= toDay) {
    const last = addDays(cursor, REPORTS_MAX_SPAN_DAYS - 1)
    const end = last > toDay ? toDay : last
    windows.push({ from: cursor, to: end })
    cursor = addDays(end, 1)
  }
  return windows
}

const OPTIONS = {
  'dry-run': { type: 'boolean' as const, default: false },
  'db-path': { type: 'string' as const },
}

export async function runImport(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, OPTIONS)
  const [source] = args.positionals

  if (source !== 'toggl') {
    throw new UsageError('Usage: toggl import toggl [--dry-run] [--db-path FILE]')
  }

  const ctx = await createContext(args)
  const dryRun = readBoolean(args, 'dry-run')
  const path = readString(args, 'db-path') ?? databasePath()

  const fromDay = readString(args, 'from') ?? IMPORT_EPOCH_DAY
  const toDay = readString(args, 'to') ?? localDay(ctx.now, ctx.timezone)

  const byId = new Map<number, WireTimeEntry>()
  const sources = new Set<string>()
  let truncated = false

  for (const window of importWindows(fromDay, toDay)) {
    const range = resolveDateRange(
      { from: window.from, to: window.to },
      { timezone: ctx.timezone, beginningOfWeek: ctx.me.beginning_of_week, now: ctx.now },
    )
    const fetched = await fetchTimeEntries(ctx.client, {
      range,
      workspaceId: ctx.workspaceId,
      userId: ctx.me.id,
      catalog: ctx.catalog,
      hasExplicitRange: true,
    })
    for (const entry of fetched.entries) byId.set(entry.id, entry)
    sources.add(fetched.source)
    truncated = truncated || fetched.truncated
  }

  const entries = [...byId.values()]
  const range = { fromDay, toDay }
  const fetched = { entries, source: [...sources].join('+'), truncated }

  const projects = [...ctx.catalog.projects.values()].filter(
    (project) => project.workspace_id === ctx.workspaceId,
  )

  if (dryRun) {
    const payload = {
      databasePath: path,
      applied: false,
      range: { from: range.fromDay, to: range.toDay },
      source: fetched.source,
      wouldImport: {
        projects: projects.length,
        entries: fetched.entries.length,
        running: fetched.entries.filter((entry) => entry.stop === null || entry.duration < 0).length,
      },
      truncated: fetched.truncated,
    }
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('import', payload))
    } else {
      writeOut(`Database  : ${path}`)
      writeOut(`Range     : ${range.fromDay} to ${range.toDay} (via ${fetched.source})`)
      writeOut(`Projects  : ${payload.wouldImport.projects}`)
      writeOut(`Entries   : ${payload.wouldImport.entries}`)
      writeOut(`Running   : ${payload.wouldImport.running}`)
      writeOut('Nothing was written. Drop --dry-run to apply.')
    }
    return 0
  }

  const db = openDatabase(path)
  try {
    const summary = importFromToggl(db, {
      projects,
      entries: fetched.entries,
      catalog: ctx.catalog,
      now: new Date().toISOString(),
    })
    const payload = {
      databasePath: path,
      applied: true,
      range: { from: range.fromDay, to: range.toDay },
      source: fetched.source,
      truncated: fetched.truncated,
      ...summary,
      projectsTotal: listProjects(db, true).length,
    }

    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('import', payload))
    } else {
      writeOut(`Database  : ${path}`)
      writeOut(`Projects  : ${summary.projectsCreated} created, ${summary.projectsSkipped} already there`)
      writeOut(`Entries   : ${summary.entriesCreated} created, ${summary.entriesSkipped} already there`)
      writeOut(`Registered: ${summary.entriesLinked} linked to Jira`)
      writeOut(`Running   : ${summary.entriesRunning}`)
    }
    return 0
  } finally {
    db.close()
  }
}
