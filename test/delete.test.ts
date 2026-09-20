import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { openMemoryDatabase } from '../src/db/open.ts'
import { findEntryWithProject, insertEntry } from '../src/db/entries.ts'
import { insertProject } from '../src/db/projects.ts'
import { readConfig } from '../src/state/config.ts'
import { findLink, linkEntry } from '../src/db/jira-links.ts'
import { listTouches, recordTouch } from '../src/db/touches.ts'
import { listDocsForEntry, upsertDoc } from '../src/db/docs.ts'
import {
  applyDeletions,
  applyProjectDeletion,
  assertPlanIsSafe,
  assertProjectPlanIsSafe,
  planDeletions,
  planProjectDeletion,
  readIds,
  type PlanContext,
} from '../src/cli/commands/delete.ts'

const NOW = '2026-09-20T12:00:00.000Z'
const TEST_TZ = 'America/Mazatlan'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'bita-delete-'))
}

function context(db: ReturnType<typeof openMemoryDatabase>, docsRoot = scratch()): PlanContext {
  return { db, timezone: TEST_TZ, now: new Date(NOW), docsRoot }
}

function seedStopped(db: ReturnType<typeof openMemoryDatabase>, description = 'work') {
  return insertEntry(db, {
    description,
    projectId: null,
    startedAt: '2026-09-20T10:00:00.000Z',
    stoppedAt: '2026-09-20T11:00:00.000Z',
    source: 'manual',
    now: NOW,
  })
}

function seedDoc(
  db: ReturnType<typeof openMemoryDatabase>,
  docsRoot: string,
  entryId: number,
  relPath: string,
): string {
  upsertDoc(db, {
    entryId,
    relPath,
    title: 'Thing',
    titleSlug: 'thing',
    source: 'stop',
    sectionCount: 1,
    byteSize: 10,
    checksum: 'abc',
    now: NOW,
  })
  const absolute = join(docsRoot, relPath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, '# Thing\n')
  return absolute
}

test('reads ids from positionals and --ids without repeating them', () => {
  const ids = readIds({ values: { ids: '3, 4 ,3' }, positionals: ['1', '2', '1'] })
  assert.deepEqual(ids, [1, 2, 3, 4])
})

test('refuses anything that is not an entry id', () => {
  assert.throws(() => readIds({ values: {}, positionals: ['yesterday'] }), /not an entry id/)
  assert.throws(() => readIds({ values: {}, positionals: ['0'] }), /not an entry id/)
  assert.throws(() => readIds({ values: {}, positionals: [] }), /Usage: bita delete/)
})

test('plans a stopped entry with its documents resolved against the docs root', () => {
  const db = openMemoryDatabase()
  const docsRoot = scratch()
  const project = insertProject(db, { name: 'bita', createdAt: NOW })
  const entry = insertEntry(db, {
    description: '  spaced   title ',
    projectId: project.id,
    startedAt: '2026-09-20T10:00:00.000Z',
    stoppedAt: '2026-09-20T11:00:00.000Z',
    source: 'manual',
    now: NOW,
  })
  const docPath = seedDoc(db, docsRoot, entry.id, 'bita/2026/09/20-1-thing.md')
  recordTouch(db, entry.id, '/tmp/a.ts', NOW)

  const plan = planDeletions(context(db, docsRoot), [entry.id], false)

  assert.deepEqual(plan.missing, [])
  assert.deepEqual(plan.running, [])
  assert.equal(plan.targets.length, 1)
  assert.equal(plan.targets[0]?.description, 'spaced title')
  assert.equal(plan.targets[0]?.projectName, 'bita')
  assert.equal(plan.targets[0]?.durationHuman, '1h')
  assert.equal(plan.targets[0]?.touchedCount, 1)
  assert.deepEqual(plan.targets[0]?.docPaths, [docPath])
  db.close()
})

test('reports an id that no entry answers to', () => {
  const db = openMemoryDatabase()
  const plan = planDeletions(context(db), [404], false)
  assert.deepEqual(plan.missing, [404])
  assert.throws(() => assertPlanIsSafe(plan), /No entry with id 404/)
  db.close()
})

test('sends a running timer to cancel instead of deleting it', () => {
  const db = openMemoryDatabase()
  const running = insertEntry(db, {
    description: 'still going',
    projectId: null,
    startedAt: '2026-09-20T10:00:00.000Z',
    source: 'timer',
    now: NOW,
  })

  const plan = planDeletions(context(db), [running.id], false)
  assert.deepEqual(plan.running, [running.id])
  assert.equal(plan.targets.length, 0)
  assert.throws(() => assertPlanIsSafe(plan), { code: 'ENTRY_RUNNING' })
  db.close()
})

test('holds back an entry already registered in jira until it is forced', () => {
  const db = openMemoryDatabase()
  const entry = seedStopped(db)
  linkEntry(db, { entryId: entry.id, issueKey: 'INN-1225', linkedAt: NOW })

  const guarded = planDeletions(context(db), [entry.id], false)
  assert.equal(guarded.targets.length, 0)
  assert.equal(guarded.registered[0]?.issueKey, 'INN-1225')
  assert.throws(() => assertPlanIsSafe(guarded), { code: 'ENTRY_REGISTERED' })

  const forced = planDeletions(context(db), [entry.id], true)
  assert.equal(forced.registered.length, 0)
  assert.equal(forced.targets[0]?.id, entry.id)
  assert.doesNotThrow(() => assertPlanIsSafe(forced))
  db.close()
})

test('takes the link, the touches, the doc row and the file with the entry', async () => {
  const db = openMemoryDatabase()
  const docsRoot = scratch()
  const entry = seedStopped(db)
  const docPath = seedDoc(db, docsRoot, entry.id, 'bita/2026/09/20-1-thing.md')
  linkEntry(db, { entryId: entry.id, issueKey: 'INN-1', linkedAt: NOW })
  recordTouch(db, entry.id, '/tmp/a.ts', NOW)

  const plan = planDeletions(context(db, docsRoot), [entry.id], true)
  const outcome = await applyDeletions(db, plan.targets, false)

  assert.deepEqual(
    outcome.deleted.map((target) => target.id),
    [entry.id],
  )
  assert.deepEqual(outcome.docsRemoved, [docPath])
  assert.deepEqual(outcome.docsOrphaned, [])
  assert.equal(existsSync(docPath), false)
  assert.equal(findLink(db, entry.id), undefined)
  assert.deepEqual(listTouches(db, entry.id), [])
  assert.deepEqual(listDocsForEntry(db, entry.id), [])
  db.close()
})

test('leaves the document on disk when asked to keep it', async () => {
  const db = openMemoryDatabase()
  const docsRoot = scratch()
  const entry = seedStopped(db)
  const docPath = seedDoc(db, docsRoot, entry.id, 'bita/2026/09/20-1-thing.md')

  const plan = planDeletions(context(db, docsRoot), [entry.id], false)
  const outcome = await applyDeletions(db, plan.targets, true)

  assert.deepEqual(outcome.docsKept, [docPath])
  assert.deepEqual(outcome.docsRemoved, [])
  assert.equal(existsSync(docPath), true)
  db.close()
})

test('says which documents it could not remove instead of claiming it did', async () => {
  const db = openMemoryDatabase()
  const docsRoot = scratch()
  const entry = seedStopped(db)
  upsertDoc(db, {
    entryId: entry.id,
    relPath: 'bita/2026/09/20-1-gone.md',
    title: 'Gone',
    titleSlug: 'gone',
    source: 'stop',
    sectionCount: 0,
    byteSize: 0,
    checksum: '',
    now: NOW,
  })

  const plan = planDeletions(context(db, docsRoot), [entry.id], false)
  const outcome = await applyDeletions(db, plan.targets, false)

  assert.deepEqual(outcome.docsRemoved, [])
  assert.deepEqual(outcome.docsOrphaned, [join(docsRoot, 'bita/2026/09/20-1-gone.md')])
  db.close()
})

test('deletes every entry it was given or none at all', async () => {
  const db = openMemoryDatabase()
  const first = seedStopped(db, 'first')
  const second = seedStopped(db, 'second')
  const survivor = seedStopped(db, 'survivor')

  const plan = planDeletions(context(db), [first.id, second.id], false)
  const outcome = await applyDeletions(db, plan.targets, false)

  assert.equal(outcome.deleted.length, 2)
  assert.notEqual(
    db.prepare('SELECT id FROM entries WHERE id = ?').get(survivor.id),
    undefined,
  )
  assert.equal(db.prepare('SELECT id FROM entries WHERE id = ?').get(first.id), undefined)
  db.close()
})

function configWith(scope: Record<string, number>, mapped: number[] = []) {
  return {
    version: 1,
    projectMapping: Object.fromEntries(
      mapped.map((id) => [String(id), { projectName: 'x', jiraProjectKey: 'INN' }]),
    ),
    scopeMapping: Object.fromEntries(
      Object.entries(scope).map(([slug, projectId]) => [
        slug,
        { projectId, projectName: 'x', slugSource: 'remote' as const },
      ]),
    ),
  }
}

test('plans a project with everything that hangs off it', () => {
  const db = openMemoryDatabase()
  const project = insertProject(db, { name: 'bita', createdAt: NOW })
  const entry = insertEntry(db, {
    description: 'work',
    projectId: project.id,
    startedAt: '2026-09-20T10:00:00.000Z',
    stoppedAt: '2026-09-20T11:00:00.000Z',
    source: 'manual',
    now: NOW,
  })
  linkEntry(db, { entryId: entry.id, issueKey: 'INN-1', linkedAt: NOW })

  const plan = planProjectDeletion(
    context(db),
    project.id,
    configWith({ 'github.com/me/bita': project.id, 'github.com/me/other': 99 }, [project.id]),
  )

  assert.equal(plan.name, 'bita')
  assert.deepEqual(plan.entryIds, [entry.id])
  assert.deepEqual(plan.registeredIds, [entry.id])
  assert.deepEqual(plan.scopeSlugs, ['github.com/me/bita'])
  assert.equal(plan.mapped, true)
  db.close()
})

test('will not delete a project with a timer still running against it', () => {
  const db = openMemoryDatabase()
  const project = insertProject(db, { name: 'bita', createdAt: NOW })
  insertEntry(db, {
    description: 'going',
    projectId: project.id,
    startedAt: '2026-09-20T10:00:00.000Z',
    source: 'timer',
    now: NOW,
  })

  const plan = planProjectDeletion(context(db), project.id, configWith({}))
  assert.throws(() => assertProjectPlanIsSafe(plan, false), { code: 'ENTRY_RUNNING' })
  assert.throws(() => assertProjectPlanIsSafe(plan, true), { code: 'ENTRY_RUNNING' })
  db.close()
})

test('asks for force before leaving entries without a project', () => {
  const db = openMemoryDatabase()
  const project = insertProject(db, { name: 'bita', createdAt: NOW })
  insertEntry(db, {
    description: 'done',
    projectId: project.id,
    startedAt: '2026-09-20T10:00:00.000Z',
    stoppedAt: '2026-09-20T11:00:00.000Z',
    source: 'manual',
    now: NOW,
  })

  const plan = planProjectDeletion(context(db), project.id, configWith({}))
  assert.throws(() => assertProjectPlanIsSafe(plan, false), { code: 'PROJECT_HAS_ENTRIES' })
  assert.doesNotThrow(() => assertProjectPlanIsSafe(plan, true))
  db.close()
})

test('refuses a project id nothing answers to', () => {
  const db = openMemoryDatabase()
  assert.throws(
    () => planProjectDeletion(context(db), 404, configWith({})),
    /No project with id 404/,
  )
  db.close()
})

test('drops the project and its config mappings, keeping the entries without one', async () => {
  const db = openMemoryDatabase()
  const docsRoot = scratch()
  const configPath = join(docsRoot, 'config.json')
  const project = insertProject(db, { name: 'bita', createdAt: NOW })
  const entry = insertEntry(db, {
    description: 'done',
    projectId: project.id,
    startedAt: '2026-09-20T10:00:00.000Z',
    stoppedAt: '2026-09-20T11:00:00.000Z',
    source: 'manual',
    now: NOW,
  })
  writeFileSync(
    configPath,
    JSON.stringify(
      configWith({ 'github.com/me/bita': project.id, 'github.com/me/keep': 99 }, [project.id]),
    ),
  )

  const plan = planProjectDeletion(context(db, docsRoot), project.id, await readConfig(configPath))
  const outcome = await applyProjectDeletion(db, plan, configPath)

  assert.equal(outcome.removed, true)
  assert.deepEqual(outcome.scopeSlugs, ['github.com/me/bita'])
  assert.equal(outcome.mappingRemoved, true)

  const after = await readConfig(configPath)
  assert.deepEqual(Object.keys(after.scopeMapping), ['github.com/me/keep'])
  assert.deepEqual(Object.keys(after.projectMapping), [])

  const survivor = findEntryWithProject(db, entry.id)
  assert.equal(survivor?.projectId, null)
  assert.equal(survivor?.projectName, null)
  db.close()
})
