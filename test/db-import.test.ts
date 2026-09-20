import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { WireClient, WireProject, WireTimeEntry } from '../src/toggl/wire-types.ts'
import { openMemoryDatabase } from '../src/db/open.ts'
import { importFromToggl } from '../src/db/import-toggl.ts'
import { listEntriesStartedBetween, listPendingEntries } from '../src/db/entries.ts'
import { findProjectById, listProjects, nextLocalProjectId } from '../src/db/projects.ts'
import { emptyCatalog, type Catalog } from '../src/toggl/catalog.ts'

const NOW = '2026-09-19T12:00:00.000Z'
const WORKSPACE = 21_276_559

function catalogWithClient(client: WireClient): Catalog {
  const catalog = emptyCatalog()
  catalog.clients.set(client.id, client)
  catalog.tagsById.set(1, { id: 1, name: 'Registered', workspace_id: WORKSPACE })
  catalog.tagsById.set(2, { id: 2, name: 'Pending', workspace_id: WORKSPACE })
  return catalog
}

function wireProject(id: number, name: string, clientId: number | null = null): WireProject {
  return { id, workspace_id: WORKSPACE, client_id: clientId, name, active: true }
}

function wireEntry(overrides: Partial<WireTimeEntry> & { id: number; start: string }): WireTimeEntry {
  return {
    at: NOW,
    description: 'work',
    stop: '2026-09-19T11:00:00.000Z',
    duration: 3600,
    billable: false,
    project_id: null,
    task_id: null,
    tags: null,
    tag_ids: null,
    user_id: 13_041_144,
    workspace_id: WORKSPACE,
    ...overrides,
  }
}

test('keeps the toggl project ids so the jira board mapping stays valid', () => {
  const db = openMemoryDatabase()
  const catalog = catalogWithClient({ id: 77, wid: WORKSPACE, name: 'Grupo STI' })

  const summary = importFromToggl(db, {
    projects: [wireProject(213_456_789, 'Pharma STI', 77), wireProject(213_456_790, 'Dailys')],
    entries: [],
    catalog,
    now: NOW,
  })

  assert.equal(summary.projectsCreated, 2)
  assert.equal(findProjectById(db, 213_456_789)?.name, 'Pharma STI')
  assert.equal(findProjectById(db, 213_456_789)?.clientName, 'Grupo STI')
  assert.equal(nextLocalProjectId(db), 1)
  db.close()
})

test('marks an entry tagged Registered as already linked, without inventing an issue key', () => {
  const db = openMemoryDatabase()
  const catalog = catalogWithClient({ id: 77, wid: WORKSPACE, name: 'Grupo STI' })

  const summary = importFromToggl(db, {
    projects: [wireProject(213_456_789, 'Pharma STI')],
    entries: [
      wireEntry({ id: 1, start: '2026-09-18T10:00:00.000Z', tags: ['Registered'] }),
      wireEntry({ id: 2, start: '2026-09-19T10:00:00.000Z', tags: ['Pending'] }),
    ],
    catalog,
    now: NOW,
  })

  assert.equal(summary.entriesCreated, 2)
  assert.equal(summary.entriesLinked, 1)

  const pending = listPendingEntries(db)
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.externalId, 2)

  const all = listEntriesStartedBetween(db, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
  const imported = all.find((entry) => entry.externalId === 1)
  assert.equal(imported?.registered, true)
  assert.equal(imported?.issueKey, null)
  db.close()
})

test('resolves the Registered tag through tag ids when names are absent', () => {
  const db = openMemoryDatabase()
  const catalog = catalogWithClient({ id: 77, wid: WORKSPACE, name: 'Grupo STI' })

  const summary = importFromToggl(db, {
    projects: [],
    entries: [wireEntry({ id: 9, start: '2026-09-18T10:00:00.000Z', tag_ids: [1] })],
    catalog,
    now: NOW,
  })

  assert.equal(summary.entriesLinked, 1)
  db.close()
})

test('can be run twice without duplicating anything', () => {
  const db = openMemoryDatabase()
  const catalog = catalogWithClient({ id: 77, wid: WORKSPACE, name: 'Grupo STI' })
  const input = {
    projects: [wireProject(213_456_789, 'Pharma STI')],
    entries: [
      wireEntry({ id: 1, start: '2026-09-18T10:00:00.000Z', project_id: 213_456_789 }),
      wireEntry({ id: 2, start: '2026-09-19T10:00:00.000Z', project_id: 213_456_789 }),
    ],
    catalog,
    now: NOW,
  }

  importFromToggl(db, input)
  const second = importFromToggl(db, input)

  assert.equal(second.projectsCreated, 0)
  assert.equal(second.projectsSkipped, 1)
  assert.equal(second.entriesCreated, 0)
  assert.equal(second.entriesSkipped, 2)
  assert.equal(listProjects(db).length, 1)
  assert.equal(
    listEntriesStartedBetween(db, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z').length,
    2,
  )
  db.close()
})

test('carries a running entry across as still running', () => {
  const db = openMemoryDatabase()
  const catalog = catalogWithClient({ id: 77, wid: WORKSPACE, name: 'Grupo STI' })

  const summary = importFromToggl(db, {
    projects: [],
    entries: [wireEntry({ id: 5, start: '2026-09-19T10:00:00.000Z', stop: null, duration: -1 })],
    catalog,
    now: NOW,
  })

  assert.equal(summary.entriesRunning, 1)
  const [entry] = listEntriesStartedBetween(
    db,
    '2026-09-19T00:00:00.000Z',
    '2026-09-20T00:00:00.000Z',
  )
  assert.equal(entry?.stoppedAt, null)
  db.close()
})

test('drops a project reference that was never imported instead of failing', () => {
  const db = openMemoryDatabase()
  const catalog = catalogWithClient({ id: 77, wid: WORKSPACE, name: 'Grupo STI' })

  importFromToggl(db, {
    projects: [],
    entries: [wireEntry({ id: 3, start: '2026-09-19T10:00:00.000Z', project_id: 999_999 })],
    catalog,
    now: NOW,
  })

  const [entry] = listEntriesStartedBetween(
    db,
    '2026-09-19T00:00:00.000Z',
    '2026-09-20T00:00:00.000Z',
  )
  assert.equal(entry?.projectId, null)
  db.close()
})
