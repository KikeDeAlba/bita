import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TogglClient } from '../src/http/client.ts'
import { applyTagPlan } from '../src/toggl/mutations.ts'
import { buildTagPlan } from '../src/domain/tag-plan.ts'
import { createFetchMock, type FetchMock } from './helpers/fetch-mock.ts'
import { makeEntry } from './helpers/entries.ts'

const change = { add: ['registered'], remove: ['pending'] }

function clientFor(mock: FetchMock): TogglClient {
  return new TogglClient({
    token: 'abc',
    fetchImpl: mock.fetchImpl,
    sleep: mock.clock.sleep,
    now: mock.clock.now,
  })
}

test('sends a replace operation with the full desired tag array', async () => {
  const mock = createFetchMock([
    { method: 'PATCH', match: '/time_entries/', body: { success: [1, 2], failure: [] } },
  ])
  const plan = buildTagPlan([makeEntry({ id: 1 }), makeEntry({ id: 2 })], change, 456)

  const result = await applyTagPlan(clientFor(mock), plan, { verify: false })

  assert.deepEqual(result.updated, [1, 2])
  assert.deepEqual(mock.calls[0]?.body, [{ op: 'replace', path: '/tags', value: ['registered'] }])
  assert.match(mock.calls[0]?.url ?? '', /\/time_entries\/1,2$/)
})

test('reads the failure array even when the response is a 200', async () => {
  const mock = createFetchMock([
    {
      method: 'PATCH',
      match: '/time_entries/',
      body: { success: [1], failure: [{ id: 2, message: 'internal server error' }] },
    },
  ])
  const plan = buildTagPlan([makeEntry({ id: 1 }), makeEntry({ id: 2 })], change, 456)

  const result = await applyTagPlan(clientFor(mock), plan, { verify: false })

  assert.deepEqual(result.updated, [1])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]?.id, 2)
  assert.equal(result.failed[0]?.stage, 'request')
})

test('flags ids that the response mentions in neither list', async () => {
  const mock = createFetchMock([
    { method: 'PATCH', match: '/time_entries/', body: { success: [1], failure: [] } },
  ])
  const plan = buildTagPlan([makeEntry({ id: 1 }), makeEntry({ id: 2 })], change, 456)

  const result = await applyTagPlan(clientFor(mock), plan, { verify: false })

  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]?.stage, 'response')
})

test('catches a success that did not actually change the tags', async () => {
  const mock = createFetchMock([
    { method: 'PATCH', match: '/time_entries/', body: { success: [1], failure: [] } },
  ])
  const plan = buildTagPlan([makeEntry({ id: 1 })], change, 456)

  const result = await applyTagPlan(clientFor(mock), plan, {
    readEntries: async () => [
      { ...makeEntry({ id: 1 }), tags: ['pending'] } as never,
    ],
  })

  assert.deepEqual(result.updated, [])
  assert.equal(result.failed[0]?.stage, 'verification')
  assert.equal(result.verified, true)
})

test('accepts a verified change', async () => {
  const mock = createFetchMock([
    { method: 'PATCH', match: '/time_entries/', body: { success: [1], failure: [] } },
  ])
  const plan = buildTagPlan([makeEntry({ id: 1 })], change, 456)

  const result = await applyTagPlan(clientFor(mock), plan, {
    readEntries: async () => [{ id: 1, tags: ['registered'] } as never],
  })

  assert.deepEqual(result.updated, [1])
  assert.equal(result.failed.length, 0)
})

test('falls back to one put per entry when the bulk patch is rejected', async () => {
  const mock = createFetchMock([
    { method: 'PATCH', match: '/time_entries/', status: 404, text: 'not found' },
    { method: 'PUT', match: '/time_entries/1', body: {} },
  ])
  const plan = buildTagPlan([makeEntry({ id: 1 })], change, 456)

  const result = await applyTagPlan(clientFor(mock), plan, { verify: false })

  assert.equal(result.strategy, 'put')
  assert.deepEqual(result.updated, [1])

  const puts = mock.calls.filter((call) => call.method === 'PUT')
  assert.equal(puts.length, 2)
  assert.deepEqual(puts[0]?.body, { tag_action: 'delete', tags: ['pending'] })
  assert.deepEqual(puts[1]?.body, { tag_action: 'add', tags: ['registered'] })
})
