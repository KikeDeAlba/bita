import type { DatabaseSync } from 'node:sqlite'
import { queryOne } from './query.ts'

export const TIMEZONE_KEY = 'timezone'
export const BEGINNING_OF_WEEK_KEY = 'beginningOfWeek'

export function readSetting(db: DatabaseSync, key: string): string | undefined {
  const row = queryOne<{ value: string }>(
    db.prepare('SELECT value FROM settings WHERE key = ?'),
    key,
  )
  return row?.value
}

export function writeSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function resolveTimezone(db: DatabaseSync, override?: string): string {
  return override ?? readSetting(db, TIMEZONE_KEY) ?? systemTimezone()
}

export function resolveBeginningOfWeek(db: DatabaseSync): number {
  const stored = readSetting(db, BEGINNING_OF_WEEK_KEY)
  const parsed = stored === undefined ? Number.NaN : Number(stored)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : 1
}
