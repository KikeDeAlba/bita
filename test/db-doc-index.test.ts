import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { findDocByRelPath, upsertDoc, type NewEntryDoc } from '../src/db/docs.ts'
import { insertEntry } from '../src/db/entries.ts'
import {
  countEntryDocIndex,
  docCorpusTotals,
  docCountsByProject,
  listDocCalendarRows,
  listEntryDocIndex,
  listSearchCandidates,
} from '../src/db/index-docs.ts'
import { openMemoryDatabase } from '../src/db/open.ts'
import { insertProject } from '../src/db/projects.ts'

const NOW = '2026-09-20T12:00:00.000Z'

type Db = ReturnType<typeof openMemoryDatabase>

function entry(db: Db, startedAt: string, projectId: number | null, description = 'work'): number {
  return insertEntry(db, { description, projectId, startedAt, source: 'timer', now: NOW }).id
}

function doc(entryId: number, relPath: string, overrides: Partial<NewEntryDoc> = {}): NewEntryDoc {
  return {
    entryId,
    relPath,
    title: 'work',
    titleSlug: 'work',
    source: 'stop',
    sectionCount: 3,
    byteSize: 512,
    checksum: 'sha256:abc',
    now: NOW,
    ...overrides,
  }
}

function project(db: Db, name: string): number {
  return insertProject(db, { name, createdAt: NOW }).id
}

test('entries without a document are first class rows', () => {
  const db = openMemoryDatabase()
  const arsm = project(db, 'ARSM')
  const withDoc = entry(db, '2026-09-20T10:00:00.000Z', arsm, 'con nota')
  entry(db, '2026-09-19T10:00:00.000Z', arsm, 'sin nota')
  upsertDoc(db, doc(withDoc, 'arsm/2026/09/20-1-con-nota.md'))

  const rows = listEntryDocIndex(db)
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.doc?.relPath, 'arsm/2026/09/20-1-con-nota.md')
  assert.equal(rows[1]?.doc, null)
  assert.equal(rows[1]?.entry.description, 'sin nota')

  const only = listEntryDocIndex(db, { onlyWithDoc: true })
  assert.equal(only.length, 1)
  assert.equal(only[0]?.entry.id, withDoc)

  db.close()
})

test('orders by start descending and stays stable on ties', () => {
  const db = openMemoryDatabase()
  const first = entry(db, '2026-09-20T10:00:00.000Z', null, 'a')
  const second = entry(db, '2026-09-20T10:00:00.000Z', null, 'b')
  entry(db, '2026-09-18T10:00:00.000Z', null, 'c')

  const ids = listEntryDocIndex(db).map((row) => row.entry.id)
  assert.deepEqual(ids.slice(0, 2), [second, first])

  db.close()
})

test('limit and offset page without gaps or repeats', () => {
  const db = openMemoryDatabase()
  for (let day = 1; day <= 7; day += 1) {
    entry(db, `2026-09-0${day}T10:00:00.000Z`, null, `entry ${day}`)
  }

  const all = listEntryDocIndex(db, { limit: 0 }).map((row) => row.entry.id)
  const paged = [
    ...listEntryDocIndex(db, { limit: 3, offset: 0 }),
    ...listEntryDocIndex(db, { limit: 3, offset: 3 }),
    ...listEntryDocIndex(db, { limit: 3, offset: 6 }),
  ].map((row) => row.entry.id)

  assert.deepEqual(paged, all)
  assert.equal(countEntryDocIndex(db), all.length)

  db.close()
})

test('a project filter and the no project bucket are distinct', () => {
  const db = openMemoryDatabase()
  const arsm = project(db, 'ARSM')
  entry(db, '2026-09-20T10:00:00.000Z', arsm)
  entry(db, '2026-09-19T10:00:00.000Z', null)

  assert.equal(countEntryDocIndex(db, { projectId: arsm }), 1)
  assert.equal(countEntryDocIndex(db, { projectId: null }), 1)

  const counts = docCountsByProject(db)
  const orphan = counts.find((row) => row.projectId === null)
  assert.ok(orphan)
  assert.equal(orphan.entryCount, 1)
  assert.equal(orphan.projectName, null)

  db.close()
})

test('appendices are counted without duplicating the note row', () => {
  const db = openMemoryDatabase()
  const arsm = project(db, 'ARSM')
  const id = entry(db, '2026-09-20T10:00:00.000Z', arsm)
  upsertDoc(db, doc(id, 'arsm/2026/09/20-1-work.md'))
  upsertDoc(db, doc(id, 'arsm/2026/09/20-1-work--anexo.md', { kind: 'appendix' }))

  const rows = listEntryDocIndex(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.appendixCount, 1)
  assert.equal(rows[0]?.doc?.kind, 'note')

  const counts = docCountsByProject(db)
  assert.equal(counts[0]?.entryCount, 1)
  assert.equal(counts[0]?.docCount, 1)
  assert.equal(counts[0]?.appendixCount, 1)

  db.close()
})

test('corpus totals tell entries and entries with a document apart', () => {
  const db = openMemoryDatabase()
  const arsm = project(db, 'ARSM')
  const documented = entry(db, '2026-09-20T10:00:00.000Z', arsm)
  entry(db, '2026-09-19T10:00:00.000Z', arsm)
  entry(db, '2026-03-22T10:00:00.000Z', null)
  upsertDoc(db, doc(documented, 'arsm/2026/09/20-1-work.md'))
  upsertDoc(db, doc(documented, 'arsm/2026/09/20-1-work--anexo.md', { kind: 'appendix' }))

  const totals = docCorpusTotals(db)
  assert.equal(totals.entryCount, 3)
  assert.equal(totals.entriesWithDoc, 1)
  assert.equal(totals.docCount, 1)
  assert.equal(totals.appendixCount, 1)
  assert.equal(totals.minStartedAt, '2026-03-22T10:00:00.000Z')
  assert.equal(totals.maxStartedAt, '2026-09-20T10:00:00.000Z')

  db.close()
})

test('the range filter takes from inclusive and to exclusive', () => {
  const db = openMemoryDatabase()
  entry(db, '2026-09-19T23:00:00.000Z', null, 'before')
  entry(db, '2026-09-20T10:00:00.000Z', null, 'inside')
  entry(db, '2026-09-21T00:00:00.000Z', null, 'after')

  const rows = listEntryDocIndex(db, { fromUtc: '2026-09-20T00:00:00.000Z', toUtc: '2026-09-21T00:00:00.000Z' })
  assert.deepEqual(
    rows.map((row) => row.entry.description),
    ['inside'],
  )

  db.close()
})

test('calendar rows carry the project and whether there is a document', () => {
  const db = openMemoryDatabase()
  const arsm = project(db, 'ARSM')
  const documented = entry(db, '2026-09-20T10:00:00.000Z', arsm)
  entry(db, '2026-08-19T10:00:00.000Z', arsm)
  upsertDoc(db, doc(documented, 'arsm/2026/09/20-1-work.md'))

  const rows = listDocCalendarRows(db)
  assert.deepEqual(
    rows.map((row) => row.hasDoc),
    [true, false],
  )
  assert.equal(rows[0]?.projectId, arsm)

  db.close()
})

test('search candidates are notes only, newest first, with their entry metadata', () => {
  const db = openMemoryDatabase()
  const arsm = project(db, 'ARSM')
  const older = entry(db, '2026-09-18T10:00:00.000Z', arsm, 'módulo de red')
  const newer = entry(db, '2026-09-20T10:00:00.000Z', arsm, 'cognito dev')
  entry(db, '2026-09-19T10:00:00.000Z', arsm, 'sin nota')
  upsertDoc(db, doc(older, 'arsm/2026/09/18-1-red.md'))
  upsertDoc(db, doc(newer, 'arsm/2026/09/20-2-cognito.md'))
  upsertDoc(db, doc(newer, 'arsm/2026/09/20-2-cognito--anexo.md', { kind: 'appendix' }))

  const candidates = listSearchCandidates(db)
  assert.deepEqual(
    candidates.map((row) => row.doc.relPath),
    ['arsm/2026/09/20-2-cognito.md', 'arsm/2026/09/18-1-red.md'],
  )
  assert.equal(candidates[0]?.description, 'cognito dev')
  assert.equal(candidates[0]?.projectName, 'ARSM')

  db.close()
})

test('a document is found by its relative path and misses cleanly', () => {
  const db = openMemoryDatabase()
  const id = entry(db, '2026-09-20T10:00:00.000Z', null)
  upsertDoc(db, doc(id, 'arsm/2026/09/20-1-work.md'))

  assert.equal(findDocByRelPath(db, 'arsm/2026/09/20-1-work.md')?.entryId, id)
  assert.equal(findDocByRelPath(db, 'arsm/2026/09/20-1-nope.md'), undefined)

  db.close()
})
