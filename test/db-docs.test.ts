import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { openMemoryDatabase } from '../src/db/open.ts'
import { insertEntry } from '../src/db/entries.ts'
import {
  countDocs,
  deleteDoc,
  docsByEntry,
  findDocForEntry,
  listDocsForEntry,
  moveDoc,
  upsertDoc,
  type NewEntryDoc,
} from '../src/db/docs.ts'

const NOW = '2026-09-19T12:00:00.000Z'

function seedEntry(db: ReturnType<typeof openMemoryDatabase>, description = 'work') {
  return insertEntry(db, {
    description,
    projectId: null,
    startedAt: '2026-09-19T10:00:00.000Z',
    source: 'timer',
    now: NOW,
  })
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

test('records a document and then updates it in place', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)

  upsertDoc(db, doc(entry.id, 'p/2026/09/19-1-work.md'))
  upsertDoc(db, doc(entry.id, 'p/2026/09/19-1-work.md', { sectionCount: 5, checksum: 'sha256:def' }))

  assert.equal(countDocs(db), 1)
  const stored = findDocForEntry(db, entry.id)
  assert.equal(stored?.sectionCount, 5)
  assert.equal(stored?.checksum, 'sha256:def')
  db.close()
})

test('keeps the repository identity when a later write does not carry one', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)

  upsertDoc(db, doc(entry.id, 'p/a.md', { repoSlug: 'github.com/kikedealba/bita-cli', branch: 'develop' }))
  upsertDoc(db, doc(entry.id, 'p/a.md', { sectionCount: 4 }))

  const stored = findDocForEntry(db, entry.id)
  assert.equal(stored?.repoSlug, 'github.com/kikedealba/bita-cli')
  assert.equal(stored?.branch, 'develop')
  db.close()
})

test('two entries cannot claim the same file', () => {
  const db = openMemoryDatabase()
  const first = seedEntry(db)
  const second = seedEntry(db, 'other')

  upsertDoc(db, doc(first.id, 'p/shared.md'))
  assert.throws(() => upsertDoc(db, doc(second.id, 'p/shared.md')), /UNIQUE/i)
  db.close()
})

test('refuses a path that climbs out of the root', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)

  assert.throws(() => upsertDoc(db, doc(entry.id, '../escape.md')), /CHECK/i)
  assert.throws(() => upsertDoc(db, doc(entry.id, '/etc/passwd')), /CHECK/i)
  assert.throws(() => upsertDoc(db, doc(entry.id, '')), /CHECK/i)
  db.close()
})

test('refuses a kind it does not know', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)
  assert.throws(() => upsertDoc(db, doc(entry.id, 'p/a.md', { kind: 'whatever' as never })), /CHECK/i)
  db.close()
})

test('a document cannot outlive its entry', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)
  upsertDoc(db, doc(entry.id, 'p/a.md'))

  db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id)
  assert.equal(listDocsForEntry(db, entry.id).length, 0)
  assert.equal(countDocs(db), 0)
  db.close()
})

test('refuses a document hanging off an entry that never existed', () => {
  const db = openMemoryDatabase()
  assert.throws(() => upsertDoc(db, doc(999, 'p/a.md')), /FOREIGN KEY/i)
  db.close()
})

test('groups the documents of several entries at once', () => {
  const db = openMemoryDatabase()
  const first = seedEntry(db)
  const second = seedEntry(db, 'other')

  upsertDoc(db, doc(first.id, 'p/a.md'))
  upsertDoc(db, doc(second.id, 'p/b.md'))
  upsertDoc(db, doc(second.id, 'p/b--plan.md', { kind: 'appendix' }))

  const byEntry = docsByEntry(db, [first.id, second.id])
  assert.equal(byEntry.get(first.id)?.length, 1)
  assert.equal(byEntry.get(second.id)?.length, 2)
  db.close()
})

test('moves a document when the draft finally earns a title', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)
  upsertDoc(db, doc(entry.id, 'p/2026/09/19-1-draft.md', { titleSlug: 'draft' }))

  assert.equal(moveDoc(db, entry.id, 'p/2026/09/19-1-draft.md', 'p/2026/09/19-1-real.md', 'real', NOW), true)
  assert.equal(findDocForEntry(db, entry.id)?.relPath, 'p/2026/09/19-1-real.md')
  assert.equal(findDocForEntry(db, entry.id)?.titleSlug, 'real')
  assert.equal(moveDoc(db, entry.id, 'p/nowhere.md', 'p/other.md', 'other', NOW), false)
  db.close()
})

test('deletes one document without touching the others', () => {
  const db = openMemoryDatabase()
  const entry = seedEntry(db)
  upsertDoc(db, doc(entry.id, 'p/a.md'))
  upsertDoc(db, doc(entry.id, 'p/a--plan.md', { kind: 'appendix' }))

  assert.equal(deleteDoc(db, entry.id, 'p/a--plan.md'), true)
  assert.equal(listDocsForEntry(db, entry.id).length, 1)
  assert.equal(deleteDoc(db, entry.id, 'p/a--plan.md'), false)
  db.close()
})
