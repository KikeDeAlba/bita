import type { DatabaseSync } from 'node:sqlite'
import type { DocKind } from '../docs/layout.ts'
import type { NoteSource } from '../state/notes.ts'
import { queryAll, queryOne } from './query.ts'

export interface EntryDocRow {
  entryId: number
  relPath: string
  kind: DocKind
  title: string
  titleSlug: string
  source: NoteSource
  sectionCount: number
  byteSize: number
  checksum: string
  repoSlug: string | null
  branch: string | null
  headSha: string | null
  createdAt: string
  recordedAt: string
}

interface DocRow {
  entry_id: number
  rel_path: string
  kind: DocKind
  title: string
  title_slug: string
  source: NoteSource
  section_count: number
  byte_size: number
  checksum: string
  repo_slug: string | null
  branch: string | null
  head_sha: string | null
  created_at: string
  recorded_at: string
}

export interface NewEntryDoc {
  entryId: number
  relPath: string
  kind?: DocKind
  title: string
  titleSlug: string
  source: NoteSource
  sectionCount: number
  byteSize: number
  checksum: string
  repoSlug?: string | null
  branch?: string | null
  headSha?: string | null
  now: string
}

const COLUMNS = `entry_id, rel_path, kind, title, title_slug, source, section_count, byte_size,
                 checksum, repo_slug, branch, head_sha, created_at, recorded_at`

function toRow(row: DocRow): EntryDocRow {
  return {
    entryId: row.entry_id,
    relPath: row.rel_path,
    kind: row.kind,
    title: row.title,
    titleSlug: row.title_slug,
    source: row.source,
    sectionCount: row.section_count,
    byteSize: row.byte_size,
    checksum: row.checksum,
    repoSlug: row.repo_slug,
    branch: row.branch,
    headSha: row.head_sha,
    createdAt: row.created_at,
    recordedAt: row.recorded_at,
  }
}

export function upsertDoc(db: DatabaseSync, doc: NewEntryDoc): void {
  db.prepare(
    `INSERT INTO entry_docs (${COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (entry_id, rel_path) DO UPDATE SET
       title = excluded.title,
       title_slug = excluded.title_slug,
       source = excluded.source,
       section_count = excluded.section_count,
       byte_size = excluded.byte_size,
       checksum = excluded.checksum,
       repo_slug = COALESCE(excluded.repo_slug, entry_docs.repo_slug),
       branch = COALESCE(excluded.branch, entry_docs.branch),
       head_sha = COALESCE(excluded.head_sha, entry_docs.head_sha),
       recorded_at = excluded.recorded_at`,
  ).run(
    doc.entryId,
    doc.relPath,
    doc.kind ?? 'note',
    doc.title,
    doc.titleSlug,
    doc.source,
    doc.sectionCount,
    doc.byteSize,
    doc.checksum,
    doc.repoSlug ?? null,
    doc.branch ?? null,
    doc.headSha ?? null,
    doc.now,
    doc.now,
  )
}

export function findDocForEntry(
  db: DatabaseSync,
  entryId: number,
  kind: DocKind = 'note',
): EntryDocRow | undefined {
  const row = queryOne<DocRow>(
    db.prepare(`SELECT ${COLUMNS} FROM entry_docs WHERE entry_id = ? AND kind = ? ORDER BY rel_path LIMIT 1`),
    entryId,
    kind,
  )
  return row ? toRow(row) : undefined
}

export function findDocByRelPath(db: DatabaseSync, relPath: string): EntryDocRow | undefined {
  const row = queryOne<DocRow>(db.prepare(`SELECT ${COLUMNS} FROM entry_docs WHERE rel_path = ?`), relPath)
  return row ? toRow(row) : undefined
}

export function listDocsForEntry(db: DatabaseSync, entryId: number): EntryDocRow[] {
  return queryAll<DocRow>(
    db.prepare(`SELECT ${COLUMNS} FROM entry_docs WHERE entry_id = ? ORDER BY kind, rel_path`),
    entryId,
  ).map(toRow)
}

export function docsByEntry(db: DatabaseSync, entryIds: number[]): Map<number, EntryDocRow[]> {
  const byEntry = new Map<number, EntryDocRow[]>()
  if (entryIds.length === 0) return byEntry

  const placeholders = entryIds.map(() => '?').join(', ')
  const rows = queryAll<DocRow>(
    db.prepare(
      `SELECT ${COLUMNS} FROM entry_docs
       WHERE entry_id IN (${placeholders})
       ORDER BY recorded_at, rel_path`,
    ),
    ...entryIds,
  )

  for (const row of rows) {
    const docs = byEntry.get(row.entry_id) ?? []
    docs.push(toRow(row))
    byEntry.set(row.entry_id, docs)
  }

  return byEntry
}

export function moveDoc(
  db: DatabaseSync,
  entryId: number,
  fromRelPath: string,
  toRelPath: string,
  titleSlug: string,
  now: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE entry_docs SET rel_path = ?, title_slug = ?, recorded_at = ?
       WHERE entry_id = ? AND rel_path = ?`,
    )
    .run(toRelPath, titleSlug, now, entryId, fromRelPath)
  return Number(result.changes) > 0
}

export function deleteDoc(db: DatabaseSync, entryId: number, relPath: string): boolean {
  const result = db.prepare('DELETE FROM entry_docs WHERE entry_id = ? AND rel_path = ?').run(entryId, relPath)
  return Number(result.changes) > 0
}

export interface CheckpointStatus {
  lastNoteAt: string | null
  touchedSinceNote: number
}

export function checkpointStatus(db: DatabaseSync, entryIds: number[]): Map<number, CheckpointStatus> {
  const byEntry = new Map<number, CheckpointStatus>()
  if (entryIds.length === 0) return byEntry

  const placeholders = entryIds.map(() => '?').join(', ')
  const rows = queryAll<{ entry_id: number; last_note_at: string | null; touched: number }>(
    db.prepare(
      `SELECT e.id AS entry_id,
              MAX(IFNULL(d.recorded_at, ''), IFNULL(p.recorded_at, '')) AS last_note_at,
              (SELECT COUNT(*) FROM entry_touches t
                WHERE t.entry_id = e.id
                  AND t.first_seen_at > MAX(IFNULL(d.recorded_at, ''), IFNULL(p.recorded_at, ''))) AS touched
       FROM entries e
       LEFT JOIN entry_docs d ON d.entry_id = e.id AND d.kind = 'note'
       LEFT JOIN page_entries pe ON pe.entry_id = e.id
       LEFT JOIN doc_pages p ON p.id = pe.page_id
       WHERE e.id IN (${placeholders})`,
    ),
    ...entryIds,
  )

  for (const row of rows) {
    byEntry.set(row.entry_id, {
      lastNoteAt: row.last_note_at === '' ? null : row.last_note_at,
      touchedSinceNote: row.touched,
    })
  }
  return byEntry
}

export function countDocs(db: DatabaseSync): number {
  return queryOne<{ total: number }>(db.prepare('SELECT COUNT(*) AS total FROM entry_docs'))?.total ?? 0
}
