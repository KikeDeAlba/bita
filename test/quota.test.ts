import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TogglClient } from '../src/http/client.ts'
import { TogglQuotaError, parseQuotaResetSeconds } from '../src/http/errors.ts'
import { createFetchMock } from './helpers/fetch-mock.ts'

const QUOTA_BODY =
  'You have hit your hourly limit for API calls. Please upgrade to a paid plan for increased access. Your quota will reset in 2861 seconds. CTA: Go to subscriptions page.'

test('reads the reset window out of the quota message', () => {
  assert.equal(parseQuotaResetSeconds(QUOTA_BODY), 2861)
  assert.equal(parseQuotaResetSeconds('nothing useful'), undefined)
  assert.equal(parseQuotaResetSeconds(undefined), undefined)
})

test('maps a 402 to a quota error instead of a generic bad request', async () => {
  const mock = createFetchMock([{ match: '/me', status: 402, text: QUOTA_BODY }])
  const client = new TogglClient({
    token: 'abc',
    fetchImpl: mock.fetchImpl,
    sleep: mock.clock.sleep,
    now: mock.clock.now,
  })

  await assert.rejects(
    () => client.get('/me'),
    (error: unknown) => {
      assert.ok(error instanceof TogglQuotaError)
      assert.equal(error.resetSeconds, 2861)
      assert.equal(error.code, 'QUOTA_EXHAUSTED')
      assert.match(error.message, /about 48 minutes/)
      assert.match(error.message, /Nothing was written/)
      return true
    },
  )
})

test('does not retry a quota error, since retrying cannot help', async () => {
  const mock = createFetchMock([{ match: '/me', status: 402, text: QUOTA_BODY }])
  const client = new TogglClient({
    token: 'abc',
    fetchImpl: mock.fetchImpl,
    sleep: mock.clock.sleep,
    now: mock.clock.now,
  })

  await assert.rejects(() => client.get('/me'), TogglQuotaError)
  assert.equal(mock.calls.length, 1)
})
