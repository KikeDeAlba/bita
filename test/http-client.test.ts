import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TogglClient } from '../src/http/client.ts'
import {
  TogglAuthError,
  TogglBadRequestError,
  TogglRateLimitError,
  TogglServerError,
  TogglWorkspaceAccessError,
} from '../src/http/errors.ts'
import { createFetchMock } from './helpers/fetch-mock.ts'

function clientFor(mock: ReturnType<typeof createFetchMock>, retries = 4): TogglClient {
  return new TogglClient({
    token: 'abc123',
    fetchImpl: mock.fetchImpl,
    sleep: mock.clock.sleep,
    now: mock.clock.now,
    retries,
  })
}

test('sends basic auth built from token and the api_token literal', async () => {
  const mock = createFetchMock([{ match: '/me', body: { id: 1 } }])
  await clientFor(mock).get('/me')

  const expected = `Basic ${Buffer.from('abc123:api_token').toString('base64')}`
  assert.equal(mock.calls[0]?.headers.get('authorization'), expected)
  assert.match(mock.calls[0]?.headers.get('user-agent') ?? '', /^toggl-track-cli\//)
})

test('maps an auth failure body on 403 to TogglAuthError without retrying', async () => {
  const mock = createFetchMock([
    { match: '/me', status: 403, text: 'Incorrect username and/or password' },
  ])

  await assert.rejects(() => clientFor(mock).get('/me'), TogglAuthError)
  assert.equal(mock.calls.length, 1)
})

test('maps a non-auth 403 to a workspace access error', async () => {
  const mock = createFetchMock([{ match: '/workspaces/1/tags', status: 403, text: 'no access to workspace' }])

  await assert.rejects(() => clientFor(mock).get('/workspaces/1/tags'), TogglWorkspaceAccessError)
})

test('does not retry a 400', async () => {
  const mock = createFetchMock([{ match: '/me', status: 400, text: 'bad request' }])

  await assert.rejects(() => clientFor(mock).get('/me'), TogglBadRequestError)
  assert.equal(mock.calls.length, 1)
})

test('retries a 500 until the attempts run out', async () => {
  const mock = createFetchMock([{ match: '/me', status: 500, text: 'boom' }])

  await assert.rejects(() => clientFor(mock, 2).get('/me'), TogglServerError)
  assert.equal(mock.calls.length, 3)
})

test('honours Retry-After on a 429 and then succeeds', async () => {
  const mock = createFetchMock([
    { match: '/me', status: 429, headers: { 'retry-after': '2' }, times: 1 },
    { match: '/me', body: { id: 7 }, times: 1 },
  ])
  const client = clientFor(mock)
  const startedAt = mock.clock.elapsed()

  const response = await client.get<{ id: number }>('/me')

  assert.equal(response.data.id, 7)
  assert.equal(mock.calls.length, 2)
  assert.ok(mock.clock.elapsed() - startedAt >= 2000)
})

test('gives up on a 429 once the retries are exhausted', async () => {
  const mock = createFetchMock([{ match: '/me', status: 429 }])

  await assert.rejects(() => clientFor(mock, 1).get('/me'), TogglRateLimitError)
  assert.equal(mock.calls.length, 2)
})

test('keeps at least one second between consecutive requests', async () => {
  const mock = createFetchMock([{ match: '/me', body: { id: 1 } }])
  const client = clientFor(mock)

  await Promise.all([client.get('/me'), client.get('/me'), client.get('/me')])

  const times = mock.calls.map((call) => call.at)
  assert.equal(times.length, 3)
  assert.ok((times[1] ?? 0) - (times[0] ?? 0) >= 1000)
  assert.ok((times[2] ?? 0) - (times[1] ?? 0) >= 1000)
})

test('keeps the queue alive after a failed request', async () => {
  const mock = createFetchMock([
    { match: '/fail', status: 400, text: 'nope', times: 1 },
    { match: '/ok', body: { id: 2 }, times: 1 },
  ])
  const client = clientFor(mock)

  await assert.rejects(() => client.get('/fail'))
  const response = await client.get<{ id: number }>('/ok')

  assert.equal(response.data.id, 2)
})

test('exposes response headers so reports pagination can read them', async () => {
  const mock = createFetchMock([
    { method: 'POST', match: '/search/time_entries', body: [], headers: { 'x-next-row-number': '51' } },
  ])

  const response = await clientFor(mock).post('/workspace/1/search/time_entries', {}, { base: 'reports' })

  assert.equal(response.headers.get('x-next-row-number'), '51')
})
