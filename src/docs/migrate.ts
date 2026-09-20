import type { DatabaseSync } from 'node:sqlite'
import { findEntryWithProject } from '../db/entries.ts'
import { recordTouch } from '../db/touches.ts'
import { readNotes, type EntryNote } from '../state/notes.ts'
import { docRelPath } from './layout.ts'
import { recordEntryDoc, type DocsContext } from './record.ts'

export type MigrationAction = 'create' | 'update' | 'skip' | 'orphan'

export interface MigrationItem {
  entryId: number
  relPath: string | null
  notes: number
  action: MigrationAction
}

export interface MigrationReport {
  scanned: number
  entries: number
  created: number
  updated: number
  skipped: number
  orphans: number[]
  items: MigrationItem[]
  dryRun: boolean
}

function bodiesOf(notes: EntryNote[]): string {
  const seen = new Set<string>()
  const bodies: string[] = []
  for (const note of notes) {
    const body = note.body.trim()
    if (body.length === 0 || seen.has(body)) continue
    seen.add(body)
    bodies.push(body)
  }
  return bodies.join('\n\n')
}

function artifactsOf(notes: EntryNote[]): { files: string[]; section: string } {
  const files = new Set<string>()
  const commands = new Set<string>()
  const resources = new Set<string>()

  for (const note of notes) {
    for (const file of note.artifacts.files) files.add(file)
    for (const command of note.artifacts.commands) commands.add(command)
    for (const resource of note.artifacts.resources) resources.add(resource)
  }

  const parts: string[] = []
  if (commands.size > 0) {
    parts.push('### Comandos', '', ...[...commands].map((command) => `- \`${command}\``))
  }
  if (resources.size > 0) {
    if (parts.length > 0) parts.push('')
    parts.push('### Recursos', '', ...[...resources].map((resource) => `- ${resource}`))
  }

  return { files: [...files], section: parts.join('\n') }
}

function groupByEntry(notes: EntryNote[]): Map<number, EntryNote[]> {
  const byEntry = new Map<number, EntryNote[]>()
  for (const note of notes) {
    const bucket = byEntry.get(note.entryId) ?? []
    bucket.push(note)
    byEntry.set(note.entryId, bucket)
  }
  for (const bucket of byEntry.values()) {
    bucket.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
  }
  return byEntry
}

export interface MigrateOptions {
  dryRun?: boolean
  limit?: number
  notesPath?: string
}

export async function migrateNotes(
  ctx: DocsContext & { db: DatabaseSync },
  options: MigrateOptions = {},
): Promise<MigrationReport> {
  const notes = options.notesPath ? await readNotes(options.notesPath) : await readNotes()
  const byEntry = groupByEntry(notes)
  const entryIds = [...byEntry.keys()].sort((left, right) => left - right)
  const selected = options.limit === undefined ? entryIds : entryIds.slice(0, options.limit)

  const report: MigrationReport = {
    scanned: notes.length,
    entries: selected.length,
    created: 0,
    updated: 0,
    skipped: 0,
    orphans: [],
    items: [],
    dryRun: options.dryRun === true,
  }

  for (const entryId of selected) {
    const bucket = byEntry.get(entryId) ?? []
    const entry = findEntryWithProject(ctx.db, entryId)

    if (!entry) {
      report.orphans.push(entryId)
      report.items.push({ entryId, relPath: null, notes: bucket.length, action: 'orphan' })
      continue
    }

    const body = bodiesOf(bucket)
    const { files, section: touched } = artifactsOf(bucket)
    const last = bucket.at(-1)
    const identity = last?.repo
      ? {
          slug: last.repo.slug,
          ...(last.repo.branch !== undefined ? { branch: last.repo.branch } : {}),
          ...(last.repo.headSha !== undefined ? { headSha: last.repo.headSha } : {}),
        }
      : null

    if (report.dryRun) {
      report.items.push({
        entryId,
        relPath: plannedPath(ctx, entry),
        notes: bucket.length,
        action: 'create',
      })
      report.created += 1
      continue
    }

    const now = ctx.now.toISOString()
    for (const file of files) recordTouch(ctx.db, entryId, file, now)

    const recorded = await recordEntryDoc(ctx, entry, {
      source: last?.source ?? 'manual',
      identity,
      create: true,
      ...(body.length > 0 ? { section: { heading: 'Qué se hizo', body } } : {}),
    })

    const withTouched =
      touched.length === 0
        ? recorded
        : await recordEntryDoc(ctx, entry, {
            source: last?.source ?? 'manual',
            identity,
            section: { heading: 'Tocado', body: touched },
          })

    const result = withTouched ?? recorded
    if (!result) {
      report.skipped += 1
      report.items.push({ entryId, relPath: null, notes: bucket.length, action: 'skip' })
      continue
    }

    const born = recorded?.created === true
    const touchedAnything = born || result.changed || recorded?.changed === true
    const action: MigrationAction = born ? 'create' : touchedAnything ? 'update' : 'skip'
    if (action === 'create') report.created += 1
    else if (action === 'update') report.updated += 1
    else report.skipped += 1

    report.items.push({ entryId, relPath: result.relPath, notes: bucket.length, action })
  }

  return report
}

function plannedPath(ctx: DocsContext, entry: ReturnType<typeof findEntryWithProject>): string | null {
  if (!entry) return null
  return docRelPath({
    entryId: entry.id,
    startedAt: entry.startedAt,
    timezone: ctx.timezone,
    projectName: entry.projectName,
    description: entry.description,
  })
}
