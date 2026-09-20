import type { EntryDocRow } from '../db/docs.ts'
import { SUMMARY_NOTES_BUDGET_BYTES } from '../config/constants.ts'
import { filledSections, parseDocument } from './markdown.ts'
import { resolveDocPath } from './paths.ts'
import { readRaw } from './store.ts'

export type NotesMode = 'inline' | 'path' | 'both'

export interface SummaryDoc {
  entryId: number
  relPath: string
  path: string
  title: string
  bytes: number
  sections: string[]
  markdown: string | null
  truncated: boolean
  missing: boolean
}

export interface LoadedDocs {
  byEntry: Map<number, SummaryDoc[]>
  inlinedBytes: number
  truncatedEntryIds: number[]
  missingFiles: number[]
}

export function parseNotesMode(raw: string | undefined): NotesMode {
  if (raw === undefined) return 'both'
  if (raw === 'inline' || raw === 'path' || raw === 'both') return raw
  return 'both'
}

export async function loadSummaryDocs(
  docsRoot: string,
  docsByEntryId: Map<number, EntryDocRow[]>,
  options: { mode?: NotesMode; budgetBytes?: number } = {},
): Promise<LoadedDocs> {
  const mode = options.mode ?? 'both'
  const budget = options.budgetBytes ?? SUMMARY_NOTES_BUDGET_BYTES
  const loaded: LoadedDocs = {
    byEntry: new Map(),
    inlinedBytes: 0,
    truncatedEntryIds: [],
    missingFiles: [],
  }

  for (const [entryId, rows] of docsByEntryId) {
    const docs: SummaryDoc[] = []

    for (const row of rows) {
      const path = resolveDocPath(docsRoot, row.relPath)
      const base: SummaryDoc = {
        entryId,
        relPath: row.relPath,
        path,
        title: row.title,
        bytes: row.byteSize,
        sections: [],
        markdown: null,
        truncated: false,
        missing: false,
      }

      if (mode === 'path') {
        docs.push(base)
        continue
      }

      const raw = await readRaw(path)
      if (raw === null) {
        loaded.missingFiles.push(entryId)
        docs.push({ ...base, missing: true })
        continue
      }

      const parsed = parseDocument(raw)
      const sections = filledSections(parsed)

      if (loaded.inlinedBytes + raw.length > budget) {
        loaded.truncatedEntryIds.push(entryId)
        docs.push({ ...base, sections, bytes: Buffer.byteLength(raw), truncated: true })
        continue
      }

      loaded.inlinedBytes += raw.length
      docs.push({ ...base, sections, bytes: Buffer.byteLength(raw), markdown: raw })
    }

    loaded.byEntry.set(entryId, docs)
  }

  return loaded
}
