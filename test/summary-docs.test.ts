import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { EntryDocRow } from '../src/db/docs.ts'
import { loadSummaryDocs, parseNotesMode } from '../src/docs/read.ts'

const MARKDOWN = `---
entryId: 1
---

# Algo

## Contexto

Por qué.

## Qué se hizo

- Una cosa.
`

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bita-summary-'))
}

function row(entryId: number, relPath: string): EntryDocRow {
  return {
    entryId,
    relPath,
    kind: 'note',
    title: 'Algo',
    titleSlug: 'algo',
    source: 'stop',
    sectionCount: 2,
    byteSize: MARKDOWN.length,
    checksum: 'sha256:abc',
    repoSlug: null,
    branch: null,
    headSha: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    recordedAt: '2026-09-20T00:00:00.000Z',
  }
}

function write(root: string, relPath: string): void {
  const path = join(root, relPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, MARKDOWN)
}

test('inlines the document and lists the sections that have something in them', async () => {
  const dir = scratch()
  write(dir, 'p/a.md')

  const loaded = await loadSummaryDocs(dir, new Map([[1, [row(1, 'p/a.md')]]]))
  const doc = loaded.byEntry.get(1)?.[0]
  assert.equal(doc?.markdown, MARKDOWN)
  assert.deepEqual(doc?.sections, ['Contexto', 'Qué se hizo'])
  assert.equal(doc?.truncated, false)
  assert.equal(loaded.inlinedBytes, MARKDOWN.length)
  rmSync(dir, { recursive: true, force: true })
})

test('past the budget it hands back the path instead of the text', async () => {
  const dir = scratch()
  write(dir, 'p/a.md')
  write(dir, 'p/b.md')

  const loaded = await loadSummaryDocs(
    dir,
    new Map([
      [1, [row(1, 'p/a.md')]],
      [2, [row(2, 'p/b.md')]],
    ]),
    { budgetBytes: MARKDOWN.length },
  )

  assert.notEqual(loaded.byEntry.get(1)?.[0]?.markdown, null)
  assert.equal(loaded.byEntry.get(2)?.[0]?.markdown, null)
  assert.equal(loaded.byEntry.get(2)?.[0]?.truncated, true)
  assert.notEqual(loaded.byEntry.get(2)?.[0]?.path, undefined)
  assert.deepEqual(loaded.truncatedEntryIds, [2])
  rmSync(dir, { recursive: true, force: true })
})

test('the path mode opens no file at all', async () => {
  const dir = scratch()
  const loaded = await loadSummaryDocs(dir, new Map([[1, [row(1, 'p/gone.md')]]]), { mode: 'path' })
  assert.equal(loaded.byEntry.get(1)?.[0]?.markdown, null)
  assert.equal(loaded.byEntry.get(1)?.[0]?.missing, false)
  assert.equal(loaded.inlinedBytes, 0)
  assert.deepEqual(loaded.missingFiles, [])
  rmSync(dir, { recursive: true, force: true })
})

test('a recorded document whose file went away is reported, not fatal', async () => {
  const dir = scratch()
  const loaded = await loadSummaryDocs(dir, new Map([[1, [row(1, 'p/gone.md')]]]))
  assert.equal(loaded.byEntry.get(1)?.[0]?.missing, true)
  assert.deepEqual(loaded.missingFiles, [1])
  rmSync(dir, { recursive: true, force: true })
})

test('an unknown mode falls back to both instead of failing', () => {
  assert.equal(parseNotesMode(undefined), 'both')
  assert.equal(parseNotesMode('path'), 'path')
  assert.equal(parseNotesMode('inline'), 'inline')
  assert.equal(parseNotesMode('nonsense'), 'both')
})
