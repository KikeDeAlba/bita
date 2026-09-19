import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MIRROR_STALE_MS } from '../config/constants.ts'

export const MIRROR_PATH = path.join(
  os.homedir(),
  '.local',
  'state',
  'toggl-track-cli',
  'running.json',
)

export interface RunningMirror {
  state: 'running' | 'idle'
  writtenAt: string
  entryId?: number
  workspaceId?: number
  projectId?: number | null
  description?: string
  start?: string
  tags?: string[]
}

export async function readRunningMirror(mirrorPath = MIRROR_PATH): Promise<RunningMirror | null> {
  try {
    return JSON.parse(await readFile(mirrorPath, 'utf8')) as RunningMirror
  } catch {
    return null
  }
}

export async function writeRunningMirror(
  mirror: RunningMirror,
  mirrorPath = MIRROR_PATH,
): Promise<void> {
  try {
    await mkdir(path.dirname(mirrorPath), { recursive: true, mode: 0o700 })
    const temporary = `${mirrorPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(mirror, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, mirrorPath)
  } catch {
    return
  }
}

export function isMirrorFresh(
  mirror: RunningMirror,
  now: Date,
  staleMs = MIRROR_STALE_MS,
): boolean {
  const writtenAt = Date.parse(mirror.writtenAt)
  if (!Number.isFinite(writtenAt)) return false
  return now.getTime() - writtenAt < staleMs
}
