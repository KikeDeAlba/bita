import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TogglClient } from '../src/http/client.ts'
import { buildStartBody, currentEntry, deleteEntry, startEntry, stopEntry } from '../src/toggl/timer.ts'
import { TogglBadRequestError } from '../src/http/errors.ts'
import { createFetchMock, type FetchMock } from './helpers/fetch-mock.ts'

function clientFor(mock: FetchMock): TogglClient {
  return new TogglClient({
    token: 'abc',
    fetchImpl: mock.fetchImpl,
    sleep: mock.clock.sleep,
    now: mock.clock.now,
  })
}

test('builds a running entry with a negative duration and a second precision start', () => {
  const body = buildStartBody({
    workspaceId: 456,
    description: 'Live timer',
    start: new Date('2026-09-19T21:04:11.482Z'),
  })

  assert.equal(body.duration, -1)
  assert.equal(body.start, '2026-09-19T21:04:11Z')
  assert.equal(body.workspace_id, 456)
  assert.match(body.created_with, /^toggl-track-cli\//)
})

test('prefers tag ids over tag names so a duplicate tag can never be created', () => {
  const body = buildStartBody({
    workspaceId: 456,
    description: 'Live timer',
    start: new Date('2026-09-19T21:04:11Z'),
    tagIds: [11],
    tagNames: ['pending'],
  })

  assert.deepEqual(body.tag_ids, [11])
  assert.equal(body.tags, undefined)
})

test('falls back to tag names only when no ids are known', () => {
  const body = buildStartBody({
    workspaceId: 456,
    description: 'Live timer',
    start: new Date('2026-09-19T21:04:11Z'),
    tagNames: ['Pending'],
  })

  assert.deepEqual(body.tags, ['Pending'])
  assert.equal(body.tag_ids, undefined)
})

test('posts the new entry to the workspace scope', async () => {
  const mock = createFetchMock([
    { method: 'POST', match: '/workspaces/456/time_entries', body: { id: 99, duration: -1 } },
  ])

  const entry = await startEntry(clientFor(mock), {
    workspaceId: 456,
    description: 'Live timer',
    start: new Date('2026-09-19T21:04:11Z'),
  })

  assert.equal(entry.id, 99)
  assert.match(mock.calls[0]?.url ?? '', /\/workspaces\/456\/time_entries$/)
})

test('stops an entry through the workspace scoped endpoint', async () => {
  const mock = createFetchMock([
    { method: 'PATCH', match: '/time_entries/99/stop', body: { id: 99, duration: 600 } },
  ])

  const entry = await stopEntry(clientFor(mock), 456, 99)

  assert.equal(entry.duration, 600)
  assert.match(mock.calls[0]?.url ?? '', /\/workspaces\/456\/time_entries\/99\/stop$/)
})

test('reports no running entry instead of throwing on a 404', async () => {
  const mock = createFetchMock([{ match: '/me/time_entries/current', status: 404, text: 'not found' }])

  assert.equal(await currentEntry(clientFor(mock)), null)
})

test('treats a null body from the current endpoint as no running entry', async () => {
  const mock = createFetchMock([{ match: '/me/time_entries/current', text: 'null' }])

  assert.equal(await currentEntry(clientFor(mock)), null)
})

test('does not retry a 404 from the current endpoint', async () => {
  const mock = createFetchMock([{ match: '/me/time_entries/current', status: 404, text: 'nope' }])

  await currentEntry(clientFor(mock))

  assert.equal(mock.calls.length, 1)
})

test('still surfaces a real failure from the current endpoint', async () => {
  const mock = createFetchMock([{ match: '/me/time_entries/current', status: 400, text: 'bad' }])

  await assert.rejects(() => currentEntry(clientFor(mock)), TogglBadRequestError)
})

test('deletes an entry through the workspace scope', async () => {
  const mock = createFetchMock([{ method: 'DELETE', match: '/time_entries/99', text: '' }])

  await deleteEntry(clientFor(mock), 456, 99)

  assert.equal(mock.calls[0]?.method, 'DELETE')
  assert.match(mock.calls[0]?.url ?? '', /\/workspaces\/456\/time_entries\/99$/)
})
