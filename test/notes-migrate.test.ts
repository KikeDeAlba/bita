import { strict as assert } from 'node:assert'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openMemoryDatabase } from '../src/db/open.ts'
import { insertEntry } from '../src/db/entries.ts'
import { countDocs, findDocForEntry } from '../src/db/docs.ts'
import { migrateNotes } from '../src/docs/migrate.ts'
import { TEST_TZ } from './helpers/entries.ts'

const NOW = new Date('2026-09-20T12:00:00.000Z')

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bita-migrate-'))
}

function note(entryId: number, body: string, recordedAt: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    entryId,
    recordedAt,
    source: 'stop',
    title: 'work',
    body,
    artifacts: { files: [], commands: [], resources: [] },
    ...extra,
  })
}

function seed(dir: string, lines: string[]): string {
  const notesPath = join(dir, 'entry-notes.ndjson')
  writeFileSync(notesPath, `${lines.join('\n')}\n`)
  return notesPath
}

function context(dir: string) {
  const db = openMemoryDatabase()
  return { db, docsRoot: join(dir, 'docs'), timezone: TEST_TZ, now: NOW }
}

function seedEntry(db: ReturnType<typeof openMemoryDatabase>, description: string) {
  return insertEntry(db, {
    description,
    projectId: null,
    startedAt: '2026-09-19T17:00:00.000Z',
    stoppedAt: '2026-09-19T18:00:00.000Z',
    source: 'timer',
    now: NOW.toISOString(),
  })
}

test('turns the notes of two entries into two documents', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const first = seedEntry(ctx.db, 'Primero')
  const second = seedEntry(ctx.db, 'Segundo')
  const notesPath = seed(dir, [
    note(first.id, 'lo del plan', '2026-09-19T17:10:00.000Z'),
    note(first.id, 'lo del cierre', '2026-09-19T18:00:00.000Z'),
    note(second.id, 'otra cosa', '2026-09-19T18:00:00.000Z'),
  ])

  const report = await migrateNotes(ctx, { notesPath })
  assert.equal(report.scanned, 3)
  assert.equal(report.entries, 2)
  assert.equal(report.created, 2)
  assert.equal(countDocs(ctx.db), 2)

  const stored = findDocForEntry(ctx.db, first.id)
  assert.notEqual(stored, undefined)
  const markdown = readFileSync(join(ctx.docsRoot, stored?.relPath ?? ''), 'utf8')
  assert.match(markdown, /lo del plan/)
  assert.match(markdown, /lo del cierre/)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('the dry run writes nothing and still reports the plan', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const entry = seedEntry(ctx.db, 'Primero')
  const notesPath = seed(dir, [note(entry.id, 'algo', '2026-09-19T18:00:00.000Z')])

  const report = await migrateNotes(ctx, { notesPath, dryRun: true })
  assert.equal(report.dryRun, true)
  assert.equal(report.created, 1)
  assert.equal(report.items[0]?.relPath, '_no-project/2026/09/19-1-primero.md')
  assert.equal(countDocs(ctx.db), 0)
  assert.equal(readdirSync(dir).includes('docs'), false)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('running it twice leaves the tree exactly as it was', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const entry = seedEntry(ctx.db, 'Primero')
  const notesPath = seed(dir, [note(entry.id, 'algo', '2026-09-19T18:00:00.000Z')])

  await migrateNotes(ctx, { notesPath })
  const stored = findDocForEntry(ctx.db, entry.id)
  const before = readFileSync(join(ctx.docsRoot, stored?.relPath ?? ''), 'utf8')

  const second = await migrateNotes(ctx, { notesPath })
  assert.equal(second.created, 0)
  assert.equal(second.updated, 0)
  assert.equal(second.skipped, 1)
  assert.equal(readFileSync(join(ctx.docsRoot, stored?.relPath ?? ''), 'utf8'), before)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a note whose entry is gone is counted, not thrown', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const notesPath = seed(dir, [note(4242, 'huérfana', '2026-09-19T18:00:00.000Z')])

  const report = await migrateNotes(ctx, { notesPath })
  assert.deepEqual(report.orphans, [4242])
  assert.equal(report.created, 0)
  assert.equal(countDocs(ctx.db), 0)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a truncated line is skipped without losing the rest', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const entry = seedEntry(ctx.db, 'Primero')
  const notesPath = seed(dir, [note(entry.id, 'buena', '2026-09-19T18:00:00.000Z')])
  appendFileSync(notesPath, '{"entryId":1,"body":"cortad\n')

  const report = await migrateNotes(ctx, { notesPath })
  assert.equal(report.scanned, 1)
  assert.equal(report.created, 1)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('the artifacts of every note end up in the document and in the touches', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const entry = seedEntry(ctx.db, 'Primero')
  const notesPath = seed(dir, [
    note(entry.id, 'uno', '2026-09-19T17:10:00.000Z', {
      artifacts: { files: ['src/a.ts'], commands: ['pnpm test'], resources: [] },
    }),
    note(entry.id, 'dos', '2026-09-19T18:00:00.000Z', {
      artifacts: { files: ['src/b.ts'], commands: [], resources: ['https://mr'] },
    }),
  ])

  await migrateNotes(ctx, { notesPath })
  const stored = findDocForEntry(ctx.db, entry.id)
  const markdown = readFileSync(join(ctx.docsRoot, stored?.relPath ?? ''), 'utf8')

  assert.match(markdown, /## Tocado/)
  assert.match(markdown, /pnpm test/)
  assert.match(markdown, /https:\/\/mr/)

  const touched = ctx.db.prepare('SELECT path FROM entry_touches ORDER BY path').all()
  assert.deepEqual(touched.map((row) => (row as { path: string }).path), ['src/a.ts', 'src/b.ts'])
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('only the first entries are touched when a limit is given', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const first = seedEntry(ctx.db, 'Primero')
  const second = seedEntry(ctx.db, 'Segundo')
  const notesPath = seed(dir, [
    note(first.id, 'uno', '2026-09-19T18:00:00.000Z'),
    note(second.id, 'dos', '2026-09-19T18:00:00.000Z'),
  ])

  const report = await migrateNotes(ctx, { notesPath, limit: 1 })
  assert.equal(report.entries, 1)
  assert.equal(countDocs(ctx.db), 1)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('an empty notes file is not an error', async () => {
  const dir = scratch()
  const ctx = context(dir)
  const report = await migrateNotes(ctx, { notesPath: join(dir, 'missing.ndjson') })
  assert.equal(report.scanned, 0)
  assert.equal(report.entries, 0)
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
})
