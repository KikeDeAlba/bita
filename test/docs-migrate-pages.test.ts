import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { openMemoryDatabase } from '../src/db/open.ts'
import { entriesOfPage, issuesOfPage } from '../src/db/page-links.ts'
import { listPages } from '../src/db/pages.ts'
import { firstParagraph, migratePages, splitLegacy, undoMigration } from '../src/docs/migrate-pages.ts'
import { checksumOf, parseDocument } from '../src/docs/markdown.ts'
import { writeDocument } from '../src/docs/store.ts'
import type { DocsContext } from '../src/docs/record.ts'

const NOW = new Date('2026-09-21T10:00:00.000Z')
const LEGACY_REL = 'pharma-sti/2026/09/18-10-credenciales.md'

const LEGACY = `---
bita: 1
entryId: 10
title: Credenciales y secretos
---

# Credenciales y secretos

## Contexto

El servicio arranca contra un MySQL gestionado.

## Qué se hizo

Las credenciales pasan a Secrets Manager.

Y el task definition las lee por valueFrom.

## Decisiones

Un solo secreto con JSON, no cuatro parámetros.

## Verificación

curl /health responde 200.

## Pendiente

Falta automatizar la rotación.
`

function seed(db: DatabaseSync): void {
  db.prepare('INSERT INTO projects (id, name, active, created_at) VALUES (1, ?, 1, ?)').run(
    'Pharma STI',
    NOW.toISOString(),
  )
  db.prepare(
    `INSERT INTO entries (id, project_id, description, started_at, stopped_at, source, created_at, updated_at)
     VALUES (10, 1, ?, ?, ?, 'timer', ?, ?)`,
  ).run(
    'Credenciales y secretos',
    '2026-09-18T15:00:00.000Z',
    '2026-09-18T18:10:00.000Z',
    NOW.toISOString(),
    NOW.toISOString(),
  )
  db.prepare(
    `INSERT INTO entry_docs (entry_id, rel_path, kind, title, title_slug, source, section_count,
                             byte_size, checksum, created_at, recorded_at)
     VALUES (10, ?, 'note', ?, 'credenciales-y-secretos', 'cli', 5, ?, ?, ?, ?)`,
  ).run(
    LEGACY_REL,
    'Credenciales y secretos',
    Buffer.byteLength(LEGACY),
    checksumOf(LEGACY),
    NOW.toISOString(),
    NOW.toISOString(),
  )
  db.prepare('INSERT INTO jira_links (entry_id, issue_key, worklog_id, linked_at) VALUES (10, ?, ?, ?)').run(
    'PSTI-142',
    '900',
    NOW.toISOString(),
  )
}

async function context(): Promise<{ ctx: DocsContext; root: string; legacy: string }> {
  const root = mkdtempSync(join(tmpdir(), 'bita-migrate-'))
  const db = openMemoryDatabase()
  seed(db)

  const legacy = join(root, LEGACY_REL)
  await writeDocument(legacy, parseDocument(LEGACY))

  return { ctx: { db, docsRoot: root, timezone: 'America/Mazatlan', now: NOW }, root, legacy }
}

test('the first paragraph is what seeds the work log', () => {
  assert.equal(firstParagraph('\n\nLas credenciales pasan.\n\nY luego otra cosa.\n'), 'Las credenciales pasan.')
  assert.equal(firstParagraph('- una viñeta\n- otra\n\nY un párrafo.'), 'una viñeta otra')
  assert.equal(firstParagraph('   \n  \n'), '')
})

test('the legacy body keeps only what describes the world', () => {
  const { body, said } = splitLegacy(parseDocument(LEGACY).sections)

  assert.deepEqual(
    body.map((section) => section.heading),
    ['Contexto', 'Decisiones'],
  )
  assert.equal(said, 'Las credenciales pasan a Secrets Manager.')
})

test('a dry run changes nothing on disk and creates no page', async () => {
  const { ctx, root, legacy } = await context()
  const before = await stat(legacy)

  const report = await migratePages(ctx, { dryRun: true })

  assert.equal(report.dryRun, true)
  assert.equal(report.migrated.length, 1)
  assert.equal(report.migrated[0]?.pageId, null)
  assert.equal(listPages(ctx.db).length, 0)

  const after = await stat(legacy)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(checksumOf(await readFile(legacy, 'utf8')), checksumOf(LEGACY))

  ctx.db.close()
  rmSync(root, { recursive: true, force: true })
})

test('applying it creates a page and leaves the old file byte for byte', async () => {
  const { ctx, root, legacy } = await context()

  const report = await migratePages(ctx, { dryRun: false, siteUrl: 'https://x.atlassian.net' })
  assert.equal(report.migrated.length, 1)

  assert.equal(await readFile(legacy, 'utf8'), LEGACY)

  const [page] = listPages(ctx.db)
  assert.equal(page?.title, 'Credenciales y secretos')
  assert.equal(page?.relPath, 'pharma-sti/credenciales-y-secretos.md')

  const written = await readFile(join(root, page?.relPath ?? ''), 'utf8')
  assert.equal(written.includes('## Contexto'), true)
  assert.equal(written.includes('## Decisiones'), true)
  assert.equal(written.includes('## Qué se hizo'), false)
  assert.equal(written.includes('## Verificación'), false)
  assert.equal(written.includes('migratedFrom: pharma-sti/2026/09/18-10-credenciales.md'), true)

  ctx.db.close()
  rmSync(root, { recursive: true, force: true })
})

test('the block becomes a row of the work log, with its issue', async () => {
  const { ctx, root } = await context()
  await migratePages(ctx, { dryRun: false, siteUrl: 'https://x.atlassian.net' })

  const [page] = listPages(ctx.db)
  const id = page?.id as number

  assert.deepEqual(
    entriesOfPage(ctx.db, id).map((row) => [row.entryId, row.summary]),
    [[10, 'Las credenciales pasan a Secrets Manager.']],
  )
  assert.deepEqual(
    issuesOfPage(ctx.db, id).map((row) => [row.issueKey, row.url]),
    [['PSTI-142', 'https://x.atlassian.net/browse/PSTI-142']],
  )

  ctx.db.close()
  rmSync(root, { recursive: true, force: true })
})

test('running it twice does not make the page twice', async () => {
  const { ctx, root } = await context()
  await migratePages(ctx, { dryRun: false })
  const second = await migratePages(ctx, { dryRun: false })

  assert.equal(second.migrated.length, 0)
  assert.equal(listPages(ctx.db).length, 1)

  ctx.db.close()
  rmSync(root, { recursive: true, force: true })
})

test('undo puts the corpus back exactly as it was', async () => {
  const { ctx, root, legacy } = await context()
  await migratePages(ctx, { dryRun: false })

  const report = await undoMigration(ctx)

  assert.equal(report.pagesRemoved, 1)
  assert.equal(report.filesRemoved, 1)
  assert.deepEqual(report.filesKept, [])
  assert.equal(listPages(ctx.db).length, 0)
  assert.equal(await readFile(legacy, 'utf8'), LEGACY)

  ctx.db.close()
  rmSync(root, { recursive: true, force: true })
})

test('undo keeps a page that was edited after the migration', async () => {
  const { ctx, root } = await context()
  await migratePages(ctx, { dryRun: false })

  const [page] = listPages(ctx.db)
  const path = join(root, page?.relPath ?? '')
  await writeDocument(path, parseDocument(`${await readFile(path, 'utf8')}\n\n## Añadido a mano\n\nAlgo.\n`))

  const report = await undoMigration(ctx)

  assert.equal(report.filesRemoved, 0)
  assert.deepEqual(report.filesKept, [page?.relPath])
  assert.equal((await readFile(path, 'utf8')).includes('Añadido a mano'), true)

  ctx.db.close()
  rmSync(root, { recursive: true, force: true })
})
