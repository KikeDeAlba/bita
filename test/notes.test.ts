import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendNote, parseNoteInput, readNotesByEntryId, type EntryNote } from '../src/state/notes.ts'
import { UsageError } from '../src/errors.ts'
import { NOTE_BODY_MAX } from '../src/config/constants.ts'

async function tempNotesPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'toggl-notes-'))
  return path.join(dir, 'entry-notes.ndjson')
}

const defaults = {
  entryId: 1,
  workspaceId: 456,
  source: 'stop' as const,
  title: 'Live timer',
  recordedAt: '2026-09-19T22:00:00.000Z',
}

function noteFor(entryId: number, body: string, recordedAt: string): EntryNote {
  return parseNoteInput({ body }, { ...defaults, entryId, recordedAt })
}

test('keeps only the last record for an entry id', async () => {
  const notesPath = await tempNotesPath()

  await appendNote(noteFor(1, 'first', '2026-09-19T22:00:00.000Z'), notesPath)
  await appendNote(noteFor(1, 'second', '2026-09-19T23:00:00.000Z'), notesPath)

  const notes = await readNotesByEntryId([1], notesPath)

  assert.equal(notes.get(1)?.body, 'second')
})

test('keeps the body of the earlier record when the later one has none', async () => {
  const notesPath = await tempNotesPath()

  await appendNote(noteFor(1, 'written at start', '2026-09-19T22:00:00.000Z'), notesPath)
  await appendNote(noteFor(1, '', '2026-09-19T23:00:00.000Z'), notesPath)

  const notes = await readNotesByEntryId([1], notesPath)

  assert.equal(notes.get(1)?.body, 'written at start')
})

test('skips a truncated line instead of failing the whole read', async () => {
  const notesPath = await tempNotesPath()

  await appendNote(noteFor(1, 'good', '2026-09-19T22:00:00.000Z'), notesPath)
  await appendFile(notesPath, '{"entryId":2,"body":"trunca\n', 'utf8')
  await appendNote(noteFor(3, 'also good', '2026-09-19T23:00:00.000Z'), notesPath)

  const notes = await readNotesByEntryId([1, 2, 3], notesPath)

  assert.equal(notes.get(1)?.body, 'good')
  assert.equal(notes.get(3)?.body, 'also good')
  assert.equal(notes.get(2), undefined)
})

test('returns nothing when the sidecar does not exist', async () => {
  const notes = await readNotesByEntryId([1], '/tmp/does-not-exist-toggl/notes.ndjson')

  assert.equal(notes.size, 0)
})

test('truncates a body over the size cap and says so', () => {
  const note = parseNoteInput({ body: 'x'.repeat(NOTE_BODY_MAX + 500) }, defaults)

  assert.ok(note.body.length < NOTE_BODY_MAX + 500)
  assert.match(note.body, /\[truncated at \d+ bytes\]$/)
})

test('rejects an unknown top level field by name', () => {
  assert.throws(
    () => parseNoteInput({ summary: 'wrong field' }, defaults),
    (error: unknown) => {
      assert.ok(error instanceof UsageError)
      assert.match(error.message, /summary/)
      return true
    },
  )
})

test('rejects artifacts that are not arrays of strings', () => {
  assert.throws(() => parseNoteInput({ artifacts: { files: [1, 2] } }, defaults), UsageError)
  assert.throws(() => parseNoteInput({ artifacts: [] }, defaults), UsageError)
})

test('rejects a note that is not an object', () => {
  assert.throws(() => parseNoteInput('just a string', defaults), UsageError)
  assert.throws(() => parseNoteInput(['a'], defaults), UsageError)
})

test('defaults the artifact lists to empty', () => {
  const note = parseNoteInput({ body: 'nothing touched' }, defaults)

  assert.deepEqual(note.artifacts, { files: [], commands: [], resources: [] })
})

test('writes the sidecar with owner only permissions', async () => {
  const notesPath = await tempNotesPath()

  await appendNote(noteFor(1, 'body', '2026-09-19T22:00:00.000Z'), notesPath)

  assert.equal((await stat(notesPath)).mode & 0o777, 0o600)
})
