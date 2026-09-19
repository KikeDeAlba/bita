import { appendFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const JOURNAL_DIR = path.join(os.homedir(), '.local', 'state', 'toggl-track-cli')
export const JOURNAL_PATH = path.join(JOURNAL_DIR, 'tag-journal.ndjson')

export interface JournalRecord {
  ts: string
  phase: 'attempt' | 'result'
  workspaceId: number
  ids: number[]
  desiredTags: string[]
  updated?: number[]
  failed?: Array<{ id: number; message: string; stage: string }>
}

export async function appendJournal(
  record: JournalRecord,
  journalPath = JOURNAL_PATH,
): Promise<void> {
  try {
    await mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 })
    await appendFile(journalPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    return
  }
}
