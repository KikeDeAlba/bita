import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deleteKeychainToken,
  readKeychainToken,
  writeKeychainToken,
} from '../src/credentials/keychain.ts'
import { maskToken, resolveToken } from '../src/credentials/token-provider.ts'
import { KeychainError, MissingTokenError } from '../src/http/errors.ts'

const options = { service: 'toggl-track-test', account: 'tester' }

test('treats exit code 44 as a missing keychain item', async () => {
  const token = await readKeychainToken(options, {
    run: async () => ({ code: 44, stdout: '', stderr: 'could not be found' }),
  })

  assert.equal(token, null)
})

test('trims the newline that security appends', async () => {
  const token = await readKeychainToken(options, {
    run: async () => ({ code: 0, stdout: 'secret-token\n', stderr: '' }),
  })

  assert.equal(token, 'secret-token')
})

test('turns any other non-zero exit into a keychain error', async () => {
  await assert.rejects(
    () => readKeychainToken(options, { run: async () => ({ code: 1, stdout: '', stderr: 'locked' }) }),
    KeychainError,
  )
})

test('never passes the token through argv when storing it', async () => {
  let seenArgs: string[] = []
  let seenInput = ''

  await writeKeychainToken('super-secret', options, {
    runWithStdin: async (args, input) => {
      seenArgs = args
      seenInput = input
      return { code: 0, stdout: '', stderr: '' }
    },
  })

  assert.deepEqual(seenArgs, ['-i'])
  assert.ok(!seenArgs.some((arg) => arg.includes('super-secret')))
  assert.match(seenInput, /add-generic-password/)
  assert.match(seenInput, /-U/)
  assert.match(seenInput, /super-secret/)
})

test('sends only the add command, since security -i has no quit', async () => {
  let seenInput = ''

  await writeKeychainToken('super-secret', options, {
    runWithStdin: async (_args, input) => {
      seenInput = input
      return { code: 0, stdout: '', stderr: '' }
    },
  })

  assert.doesNotMatch(seenInput, /quit/)
  assert.equal(seenInput.trimEnd().split('\n').length, 1)
})

test('reports whether a delete actually removed anything', async () => {
  const removed = await deleteKeychainToken(options, {
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  })
  const absent = await deleteKeychainToken(options, {
    run: async () => ({ code: 44, stdout: '', stderr: '' }),
  })

  assert.equal(removed, true)
  assert.equal(absent, false)
})

test('prefers the environment variable over the keychain', async () => {
  let keychainCalled = false

  const resolved = await resolveToken({
    env: { TOGGL_API_TOKEN: 'from-env' },
    readToken: async () => {
      keychainCalled = true
      return 'from-keychain'
    },
  })

  assert.equal(resolved.token, 'from-env')
  assert.equal(resolved.source, 'env')
  assert.equal(keychainCalled, false)
})

test('falls back to the keychain when the environment is empty', async () => {
  const resolved = await resolveToken({ env: {}, readToken: async () => 'from-keychain' })

  assert.equal(resolved.source, 'keychain')
})

test('fails with an actionable error when there is no token anywhere', async () => {
  await assert.rejects(
    () => resolveToken({ env: {}, readToken: async () => null }),
    (error: unknown) => {
      assert.ok(error instanceof MissingTokenError)
      assert.match(error.hint, /toggl auth login/)
      return true
    },
  )
})

test('masks everything but the last four characters', () => {
  assert.equal(maskToken('1971800d4d82861d8f2c1651fea41f3a'), '••••••••1f3a')
})
