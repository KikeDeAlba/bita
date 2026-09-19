import { parseArgs, type ParseArgsConfig } from 'node:util'
import { UsageError } from '../http/errors.ts'
import { RANGE_PRESETS, type DateRangeInput, type RangePreset } from '../domain/date-range.ts'
import type { TagMatchMode } from '../domain/filter.ts'
import { PENDING_TAG, REGISTERED_TAG } from '../config/constants.ts'

type OptionConfig = NonNullable<ParseArgsConfig['options']>

export const GLOBAL_OPTIONS: OptionConfig = {
  json: { type: 'boolean', default: false },
  from: { type: 'string' },
  to: { type: 'string' },
  'last-days': { type: 'string' },
  workspace: { type: 'string' },
  timezone: { type: 'string' },
  tag: { type: 'string', multiple: true },
  'exclude-tag': { type: 'string', multiple: true },
  'tag-match': { type: 'string' },
  pending: { type: 'boolean', default: false },
  registered: { type: 'boolean', default: false },
  untagged: { type: 'boolean', default: false },
  source: { type: 'string' },
  'no-cache': { type: 'boolean', default: false },
  'include-running': { type: 'boolean', default: false },
  verbose: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
}

export interface ParsedArgs {
  values: Record<string, string | boolean | string[] | undefined>
  positionals: string[]
}

export function parseCommandArgs(argv: string[], options: OptionConfig): ParsedArgs {
  try {
    const parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    })
    return { values: parsed.values as ParsedArgs['values'], positionals: parsed.positionals }
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

export function readString(args: ParsedArgs, name: string): string | undefined {
  const value = args.values[name]
  return typeof value === 'string' ? value : undefined
}

export function readBoolean(args: ParsedArgs, name: string): boolean {
  return args.values[name] === true
}

export function readStringList(args: ParsedArgs, name: string): string[] {
  const value = args.values[name]
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

export function readInteger(args: ParsedArgs, name: string): number | undefined {
  const raw = readString(args, name)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new UsageError(`Invalid value for --${name}: "${raw}". Expected an integer.`)
  }
  return parsed
}

export function readPreset(args: ParsedArgs): RangePreset | undefined {
  const first = args.positionals[0]
  if (!first) return undefined
  if (!RANGE_PRESETS.includes(first as RangePreset)) {
    throw new UsageError(
      `Unknown range preset "${first}". Valid presets: ${RANGE_PRESETS.join(', ')}.`,
    )
  }
  return first as RangePreset
}

export function readRangeInput(args: ParsedArgs): DateRangeInput {
  const preset = readPreset(args)
  const from = readString(args, 'from')
  const to = readString(args, 'to')
  const lastDays = readInteger(args, 'last-days')

  return {
    ...(preset !== undefined ? { preset } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(lastDays !== undefined ? { lastDays } : {}),
  }
}

export function hasExplicitRange(args: ParsedArgs): boolean {
  return (
    readPreset(args) !== undefined ||
    readString(args, 'from') !== undefined ||
    readString(args, 'to') !== undefined ||
    readInteger(args, 'last-days') !== undefined
  )
}

export function readTagFilter(args: ParsedArgs): {
  include: string[]
  exclude: string[]
  mode: TagMatchMode
  untaggedOnly: boolean
} {
  const include = [...readStringList(args, 'tag')]
  if (readBoolean(args, 'pending')) include.push(PENDING_TAG)
  if (readBoolean(args, 'registered')) include.push(REGISTERED_TAG)

  const rawMode = readString(args, 'tag-match') ?? 'any'
  if (rawMode !== 'any' && rawMode !== 'all') {
    throw new UsageError(`Invalid value for --tag-match: "${rawMode}". Expected "any" or "all".`)
  }

  return {
    include: [...new Set(include)],
    exclude: readStringList(args, 'exclude-tag'),
    mode: rawMode,
    untaggedOnly: readBoolean(args, 'untagged'),
  }
}
