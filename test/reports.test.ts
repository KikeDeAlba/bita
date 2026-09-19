import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TogglClient } from '../src/http/client.ts'
import { normalizeReportRows, searchReportEntries } from '../src/toggl/reports.ts'
import { fetchEntriesByIds, fetchEntryById, planFetchSource } from '../src/toggl/time-entries.ts'
import { emptyCatalog } from '../src/toggl/catalog.ts'
import { createFetchMock, type FetchMock } from './helpers/fetch-mock.ts'
import type { WireReportRow } from '../src/toggl/wire-types.ts'
import type { ResolvedRange } from '../src/domain/date-range.ts'

function clientFor(mock: FetchMock): TogglClient {
  return new TogglClient({
    token: 'abc',
    fetchImpl: mock.fetchImpl,
    sleep: mock.clock.sleep,
    now: mock.clock.now,
  })
}

const row: WireReportRow = {
  user_id: 99,
  project_id: 789,
  task_id: null,
  client_id: 55,
  description: 'ajustar pipeline',
  tag_ids: [11],
  billable: false,
  time_entries: [
    { id: 1, start: '2026-09-16T16:00:00Z', stop: '2026-09-16T17:30:00Z', seconds: 5400 },
    { id: 2, start: '2026-09-16T19:00:00Z', stop: '2026-09-16T20:00:00Z', seconds: 3600 },
  ],
}

function catalogWithTag() {
  const catalog = emptyCatalog()
  const tag = { id: 11, workspace_id: 456, name: 'pending' }
  catalog.tagsById.set(11, tag)
  catalog.tagsByName.set('pending', tag)
  return catalog
}

test('flattens a report row into one entry per nested time entry', () => {
  const entries = normalizeReportRows([row], { workspaceId: 456, catalog: catalogWithTag() })

  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.id, 1)
  assert.equal(entries[0]?.duration, 5400)
  assert.equal(entries[0]?.description, 'ajustar pipeline')
  assert.equal(entries[0]?.workspace_id, 456)
})

test('resolves tag ids into names because reports only returns ids', () => {
  const entries = normalizeReportRows([row], { workspaceId: 456, catalog: catalogWithTag() })

  assert.deepEqual(entries[0]?.tags, ['pending'])
})

test('marks a nested entry without a stop as running', () => {
  const running: WireReportRow = {
    ...row,
    time_entries: [{ id: 3, start: '2026-09-16T16:00:00Z', stop: null, seconds: 0 }],
  }

  const entries = normalizeReportRows([running], { workspaceId: 456, catalog: catalogWithTag() })

  assert.ok((entries[0]?.duration ?? 0) < 0)
})

test('follows the pagination headers until they stop coming', async () => {
  const mock = createFetchMock([
    {
      method: 'POST',
      match: '/search/time_entries',
      body: [row],
      headers: { 'x-next-row-number': '51', 'x-next-id': '900' },
      times: 1,
    },
    { method: 'POST', match: '/search/time_entries', body: [row], times: 1 },
  ])

  const result = await searchReportEntries(clientFor(mock), {
    workspaceId: 456,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
  })

  assert.equal(result.pages, 2)
  assert.equal(result.rows.length, 2)
  assert.equal(result.truncated, false)
  assert.equal((mock.calls[1]?.body as { first_row_number?: number }).first_row_number, 51)
  assert.equal((mock.calls[1]?.body as { first_id?: number }).first_id, 900)
})

test('sends the tag filter to the server', async () => {
  const mock = createFetchMock([{ method: 'POST', match: '/search/time_entries', body: [] }])

  await searchReportEntries(clientFor(mock), {
    workspaceId: 456,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    tagIds: [11],
  })

  assert.deepEqual((mock.calls[0]?.body as { tag_ids?: number[] }).tag_ids, [11])
})

function rangeOf(spanDays: number): ResolvedRange {
  return {
    fromDay: '2026-09-01',
    toDay: '2026-09-19',
    queryStartDate: '2026-08-31',
    queryEndDate: '2026-09-21',
    timezone: 'America/Mazatlan',
    preset: 'custom',
    spanDays,
  }
}

test('uses the reports endpoint when a tag filter has no explicit range', () => {
  const source = planFetchSource({
    range: rangeOf(90),
    workspaceId: 456,
    userId: 99,
    catalog: emptyCatalog(),
    tagIds: [11],
    hasExplicitRange: false,
  })

  assert.equal(source, 'reports')
})

test('uses the direct endpoint for a short explicit range', () => {
  const source = planFetchSource({
    range: rangeOf(5),
    workspaceId: 456,
    userId: 99,
    catalog: emptyCatalog(),
    tagIds: [11],
    hasExplicitRange: true,
  })

  assert.equal(source, 'me')
})

test('uses the reports endpoint for a long range', () => {
  const source = planFetchSource({
    range: rangeOf(120),
    workspaceId: 456,
    userId: 99,
    catalog: emptyCatalog(),
    hasExplicitRange: true,
  })

  assert.equal(source, 'reports')
})

test('reads a single entry from the me scope, not the workspace scope', async () => {
  const mock = createFetchMock([{ match: '/time_entries/4553028267', body: { id: 4553028267 } }])
  const client = clientFor(mock)

  const entry = await fetchEntryById(client, 4553028267)

  assert.equal(entry.id, 4553028267)
  assert.equal(
    mock.calls[0]?.url,
    'https://api.track.toggl.com/api/v9/me/time_entries/4553028267',
  )
})

test('the workspace scope rejects a single-entry GET, so it must not be used', async () => {
  const mock = createFetchMock([{ match: '/time_entries/1', body: { id: 1 } }])
  const client = clientFor(mock)

  await fetchEntriesByIds(client, [1])

  assert.doesNotMatch(mock.calls[0]?.url ?? '', /\/workspaces\/\d+\/time_entries\/\d+$/)
})

test('reads several entries one by one', async () => {
  const mock = createFetchMock([{ match: '/me/time_entries/', body: { id: 7 } }])
  const client = clientFor(mock)

  const entries = await fetchEntriesByIds(client, [7, 8])

  assert.equal(entries.length, 2)
  assert.equal(mock.calls.length, 2)
})
