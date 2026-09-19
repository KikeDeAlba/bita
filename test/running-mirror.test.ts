import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isMirrorFresh, readRunningMirror, writeRunningMirror } from '../src/state/running.ts'

async function tempMirrorPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'toggl-mirror-'))
  return path.join(dir, 'running.json')
}

test('round trips the running state', async () => {
  const mirrorPath = await tempMirrorPath()

  await writeRunningMirror(
    {
      state: 'running',
      writtenAt: '2026-09-19T22:00:00.000Z',
      entryId: 99,
      workspaceId: 456,
      description: 'Live timer',
    },
    mirrorPath,
  )

  const mirror = await readRunningMirror(mirrorPath)

  assert.equal(mirror?.state, 'running')
  assert.equal(mirror?.entryId, 99)
})

test('returns null when there is no mirror yet', async () => {
  assert.equal(await readRunningMirror('/tmp/nope-toggl/running.json'), null)
})

test('treats a mirror written within the window as fresh', () => {
  const now = new Date('2026-09-19T22:00:00.000Z')

  assert.equal(
    isMirrorFresh({ state: 'idle', writtenAt: '2026-09-19T21:00:00.000Z' }, now),
    true,
  )
})

test('treats a mirror older than the window as stale', () => {
  const now = new Date('2026-09-20T12:00:00.000Z')

  assert.equal(
    isMirrorFresh({ state: 'running', writtenAt: '2026-09-19T21:00:00.000Z' }, now),
    false,
  )
})

test('treats an unparsable timestamp as stale rather than fresh', () => {
  assert.equal(
    isMirrorFresh({ state: 'running', writtenAt: 'not a date' }, new Date()),
    false,
  )
})
