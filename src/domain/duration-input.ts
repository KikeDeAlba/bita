import { UsageError } from '../errors.ts'

const DURATION_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?$/

export function parseDurationSeconds(input: string, flag: string): number {
  const trimmed = input.trim().toLowerCase()
  const match = trimmed.match(DURATION_PATTERN)
  if (!match || trimmed.length === 0 || (!match[1] && !match[2])) {
    throw new UsageError(`Invalid value for ${flag}: "${input}". Use forms like 45m, 2h or 1h30m.`)
  }
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = hours * 3600 + minutes * 60
  if (seconds <= 0) throw new UsageError(`${flag} must be greater than zero.`)
  return seconds
}

export function parseClockTime(input: string, reference: Date, flag: string): Date {
  const trimmed = input.trim()

  const clock = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (clock?.[1] && clock[2]) {
    const hours = Number(clock[1])
    const minutes = Number(clock[2])
    if (hours > 23 || minutes > 59) {
      throw new UsageError(`Invalid time for ${flag}: "${input}".`)
    }
    // TODO(timezone): setHours resolves against the system zone, not the configured one
    const at = new Date(reference)
    at.setHours(hours, minutes, 0, 0)
    return at
  }

  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`Invalid value for ${flag}: "${input}". Use HH:MM or an ISO timestamp.`)
  }
  return new Date(parsed)
}
