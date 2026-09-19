import { UsageError } from '../http/errors.ts'
import { resolveDateRange, type ResolvedRange } from '../domain/date-range.ts'
import { matchesTagFilter, withinLocalRange, type TagFilter } from '../domain/filter.ts'
import { enrichEntries } from '../domain/enrich.ts'
import { fetchTimeEntries, type FetchMode, type FetchSource } from '../toggl/time-entries.ts'
import { resolveTagIds } from '../toggl/catalog.ts'
import type { EnrichedTimeEntry, ExcludedEntry } from '../domain/types.ts'
import type { AppContext } from './context.ts'
import {
  hasExplicitRange,
  readRangeInput,
  readString,
  readTagFilter,
  type ParsedArgs,
} from './args.ts'
import { DEFAULT_PENDING_LOOKBACK_DAYS, PENDING_TAG, REGISTERED_TAG } from '../config/constants.ts'

export interface CollectOptions {
  includeRunning: boolean
  requireDescription: boolean
  requireProject: boolean
}

export interface CollectResult {
  range: ResolvedRange
  source: FetchSource
  pages: number
  truncated: boolean
  otherWorkspaceCount: number
  filter: TagFilter
  selected: EnrichedTimeEntry[]
  excluded: ExcludedEntry[]
  alreadyRegistered: { count: number; totalSeconds: number }
  warnings: string[]
}

function toExcluded(entry: EnrichedTimeEntry, reason: string): ExcludedEntry {
  return {
    id: entry.id,
    description: entry.description,
    projectName: entry.projectName,
    localDay: entry.localDay,
    durationSeconds: entry.durationSeconds,
    durationHuman: entry.durationHuman,
    tags: entry.tags,
    reason,
  }
}

export async function collectEntries(
  ctx: AppContext,
  args: ParsedArgs,
  options: CollectOptions,
): Promise<CollectResult> {
  const filter = readTagFilter(args)
  const explicitRange = hasExplicitRange(args)
  const warnings: string[] = []

  const rangeInput = readRangeInput(args)
  if (!explicitRange && (filter.include.length > 0 || filter.untaggedOnly)) {
    rangeInput.lastDays = DEFAULT_PENDING_LOOKBACK_DAYS
    warnings.push(
      `No range given; scanning the last ${DEFAULT_PENDING_LOOKBACK_DAYS} days. Use --from or --last-days to widen.`,
    )
  }

  const range = resolveDateRange(rangeInput, {
    timezone: ctx.timezone,
    beginningOfWeek: ctx.me.beginning_of_week,
    now: ctx.now,
  })

  const resolvedTags = resolveTagIds(ctx.catalog, filter.include)
  if (resolvedTags.unknown.length > 0) {
    const available = [...ctx.catalog.tagsById.values()].map((tag) => tag.name).sort().join(', ')
    throw new UsageError(
      `Unknown tag(s) in this workspace: ${resolvedTags.unknown.join(', ')}. Available tags: ${available || '(none)'}.`,
    )
  }

  const sourceFlag = readString(args, 'source')
  if (sourceFlag && sourceFlag !== 'auto' && sourceFlag !== 'me' && sourceFlag !== 'reports') {
    throw new UsageError(`Invalid value for --source: "${sourceFlag}". Expected auto, me or reports.`)
  }

  const fetched = await fetchTimeEntries(ctx.client, {
    range,
    workspaceId: ctx.workspaceId,
    userId: ctx.me.id,
    catalog: ctx.catalog,
    tagIds: resolvedTags.ids,
    mode: (sourceFlag ?? 'auto') as FetchMode,
    hasExplicitRange: explicitRange,
  })

  if (fetched.truncated) {
    warnings.push('Toggl truncated the result set; narrow the range to be sure nothing is missing.')
  }
  if (fetched.otherWorkspaceCount > 0) {
    warnings.push(
      `${fetched.otherWorkspaceCount} entries from other workspaces were skipped. Use --workspace to switch.`,
    )
  }

  const enriched = enrichEntries(fetched.entries, ctx.catalog, ctx.timezone, ctx.now)

  const inRange = enriched.filter((entry) => withinLocalRange(entry, range.fromDay, range.toDay))
  const tagMatched = inRange.filter((entry) => matchesTagFilter(entry, filter))

  const selected: EnrichedTimeEntry[] = []
  const excluded: ExcludedEntry[] = []

  const registeredEntries = inRange.filter((entry) =>
    entry.tags.some((tag) => tag.toLowerCase() === REGISTERED_TAG),
  )
  const alreadyRegistered = {
    count: registeredEntries.length,
    totalSeconds: registeredEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0),
  }

  for (const entry of tagMatched) {
    const lowered = entry.tags.map((tag) => tag.toLowerCase())
    const hasBoth = lowered.includes(PENDING_TAG) && lowered.includes(REGISTERED_TAG)

    if (hasBoth) {
      excluded.push(toExcluded(entry, 'both-tags'))
      continue
    }
    if (entry.running && !options.includeRunning) {
      excluded.push(toExcluded(entry, 'running'))
      continue
    }
    if (options.requireProject && entry.projectId === null) {
      excluded.push(toExcluded(entry, 'no-project'))
      continue
    }
    if (options.requireDescription && entry.description.length < 3) {
      excluded.push(toExcluded(entry, 'no-description'))
      continue
    }
    if (options.requireDescription && Math.round(entry.durationSeconds / 60) === 0) {
      excluded.push(toExcluded(entry, 'zero-duration'))
      continue
    }
    selected.push(entry)
  }

  const bothTagsCount = excluded.filter((entry) => entry.reason === 'both-tags').length
  if (bothTagsCount > 0) {
    warnings.push(
      `${bothTagsCount} entries carry both "${PENDING_TAG}" and "${REGISTERED_TAG}". They were skipped: that is the signature of a half-finished retag.`,
    )
  }

  const runningCount = excluded.filter((entry) => entry.reason === 'running').length
  if (runningCount > 0) {
    warnings.push(`${runningCount} running entries were excluded; pass --include-running to count them.`)
  }

  return {
    range,
    source: fetched.source,
    pages: fetched.pages,
    truncated: fetched.truncated,
    otherWorkspaceCount: fetched.otherWorkspaceCount,
    filter,
    selected,
    excluded,
    alreadyRegistered,
    warnings,
  }
}
