import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CACHE_DIR = path.join(os.homedir(), '.cache', 'toggl-track-cli')

interface CacheEnvelope<T> {
  storedAt: number
  value: T
}

export async function readCache<T>(name: string, ttlMs: number, now: number): Promise<T | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, name), 'utf8')
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (now - envelope.storedAt > ttlMs) return null
    return envelope.value
  } catch {
    return null
  }
}

export async function writeCache<T>(name: string, value: T, now: number): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    const envelope: CacheEnvelope<T> = { storedAt: now, value }
    await writeFile(path.join(CACHE_DIR, name), JSON.stringify(envelope), 'utf8')
  } catch {
    return
  }
}
