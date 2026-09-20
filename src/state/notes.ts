import { appendFile, mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { UsageError } from '../errors.ts'
import { NOTE_BODY_MAX, NOTE_SCHEMA_VERSION } from '../config/constants.ts'

export const NOTES_DIR = path.join(os.homedir(), '.local', 'state', 'toggl-track-cli')
export const NOTES_PATH = path.join(NOTES_DIR, 'entry-notes.ndjson')

export type NoteSource = 'start' | 'stop' | 'cancel' | 'manual'

export interface NoteArtifacts {
  files: string[]
  commands: string[]
  resources: string[]
}

export interface EntryNote {
  schemaVersion: number
  entryId: number
  workspaceId: number
  recordedAt: string
  source: NoteSource
  title: string
  body: string
  artifacts: NoteArtifacts
  repo?: { slug: string; branch?: string; headSha?: string }
}

const KNOWN_KEYS = new Set([
  'schemaVersion',
  'entryId',
  'workspaceId',
  'recordedAt',
  'source',
  'title',
  'body',
  'artifacts',
  'repo',
])

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new UsageError(`Note field "${field}" must be an array of strings.`)
  }
  return value as string[]
}

export interface NoteDefaults {
  entryId: number
  workspaceId: number
  source: NoteSource
  title: string
  recordedAt: string
  repo?: { slug: string; branch?: string; headSha?: string }
}

export function parseNoteInput(raw: unknown, defaults: NoteDefaults): EntryNote {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UsageError('A note must be a JSON object.')
  }

  const input = raw as Record<string, unknown>
  const unknown = Object.keys(input).filter((key) => !KNOWN_KEYS.has(key))
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown note field(s): ${unknown.join(', ')}. Allowed: ${[...KNOWN_KEYS].join(', ')}.`,
    )
  }

  const rawBody = typeof input['body'] === 'string' ? input['body'] : ''
  const body =
    rawBody.length > NOTE_BODY_MAX
      ? `${rawBody.slice(0, NOTE_BODY_MAX)}\n\n[truncated at ${NOTE_BODY_MAX} bytes]`
      : rawBody

  const artifactsInput = (input['artifacts'] ?? {}) as Record<string, unknown>
  if (typeof artifactsInput !== 'object' || Array.isArray(artifactsInput)) {
    throw new UsageError('Note field "artifacts" must be an object.')
  }

  const repo = (input['repo'] as EntryNote['repo']) ?? defaults.repo

  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    entryId: defaults.entryId,
    workspaceId: defaults.workspaceId,
    recordedAt: defaults.recordedAt,
    source: defaults.source,
    title: typeof input['title'] === 'string' ? input['title'] : defaults.title,
    body,
    artifacts: {
      files: asStringArray(artifactsInput['files'], 'artifacts.files'),
      commands: asStringArray(artifactsInput['commands'], 'artifacts.commands'),
      resources: asStringArray(artifactsInput['resources'], 'artifacts.resources'),
    },
    ...(repo !== undefined ? { repo } : {}),
  }
}

export async function appendNote(note: EntryNote, notesPath = NOTES_PATH): Promise<void> {
  try {
    await mkdir(path.dirname(notesPath), { recursive: true, mode: 0o700 })
    await appendFile(notesPath, `${JSON.stringify(note)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    return
  }
}

export async function readNotes(notesPath = NOTES_PATH): Promise<EntryNote[]> {
  let raw: string
  try {
    raw = await readFile(notesPath, 'utf8')
  } catch {
    return []
  }

  const notes: EntryNote[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      notes.push(JSON.parse(line) as EntryNote)
    } catch {
      continue
    }
  }
  return notes
}

export async function readNotesByEntryId(
  ids: number[],
  notesPath = NOTES_PATH,
): Promise<Map<number, EntryNote>> {
  const wanted = new Set(ids)
  const latest = new Map<number, EntryNote>()

  for (const note of await readNotes(notesPath)) {
    if (!wanted.has(note.entryId)) continue
    const previous = latest.get(note.entryId)
    const merged =
      previous && note.body.length === 0 && previous.body.length > 0
        ? { ...note, body: previous.body }
        : note
    latest.set(note.entryId, merged)
  }

  return latest
}
