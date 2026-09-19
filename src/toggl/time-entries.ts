import type { TogglClient } from '../http/client.ts'
import type { Catalog } from './catalog.ts'
import type { WireTimeEntry } from './wire-types.ts'
import type { ResolvedRange } from '../domain/date-range.ts'
import { normalizeReportRows, searchReportEntries } from './reports.ts'
import { DIRECT_FETCH_MAX_SPAN_DAYS, ME_ENTRIES_HARD_LIMIT } from '../config/constants.ts'

export type FetchSource = 'me' | 'reports'
export type FetchMode = 'auto' | 'me' | 'reports'

export interface FetchOptions {
  range: ResolvedRange
  workspaceId: number
  userId: number
  catalog: Catalog
  tagIds?: number[]
  projectIds?: number[]
  mode?: FetchMode
  hasExplicitRange: boolean
}

export interface FetchResult {
  entries: WireTimeEntry[]
  source: FetchSource
  pages: number
  truncated: boolean
  otherWorkspaceCount: number
}

export function planFetchSource(options: FetchOptions): FetchSource {
  const mode = options.mode ?? 'auto'
  if (mode !== 'auto') return mode

  const filtersByTag = (options.tagIds?.length ?? 0) > 0
  if (filtersByTag && !options.hasExplicitRange) return 'reports'
  if (options.range.spanDays > DIRECT_FETCH_MAX_SPAN_DAYS) return 'reports'
  return 'me'
}

async function fetchFromMe(
  client: TogglClient,
  options: FetchOptions,
): Promise<{ entries: WireTimeEntry[]; truncated: boolean }> {
  const response = await client.get<WireTimeEntry[] | null>('/me/time_entries', {
    query: {
      start_date: options.range.queryStartDate,
      end_date: options.range.queryEndDate,
    },
  })
  const entries = response.data ?? []
  return { entries, truncated: entries.length >= ME_ENTRIES_HARD_LIMIT }
}

async function fetchFromReports(
  client: TogglClient,
  options: FetchOptions,
): Promise<{ entries: WireTimeEntry[]; pages: number; truncated: boolean }> {
  const params: Parameters<typeof searchReportEntries>[1] = {
    workspaceId: options.workspaceId,
    startDate: options.range.queryStartDate,
    endDate: options.range.queryEndDate,
    userIds: [options.userId],
  }
  if (options.tagIds?.length) params.tagIds = options.tagIds
  if (options.projectIds?.length) params.projectIds = options.projectIds

  const result = await searchReportEntries(client, params)
  return {
    entries: normalizeReportRows(result.rows, {
      workspaceId: options.workspaceId,
      catalog: options.catalog,
    }),
    pages: result.pages,
    truncated: result.truncated,
  }
}

export async function fetchTimeEntries(
  client: TogglClient,
  options: FetchOptions,
): Promise<FetchResult> {
  const planned = planFetchSource(options)

  if (planned === 'me') {
    const direct = await fetchFromMe(client, options)
    if (!direct.truncated) {
      const scoped = direct.entries.filter((entry) => entry.workspace_id === options.workspaceId)
      return {
        entries: scoped,
        source: 'me',
        pages: 1,
        truncated: false,
        otherWorkspaceCount: direct.entries.length - scoped.length,
      }
    }
  }

  const reports = await fetchFromReports(client, options)
  return {
    entries: reports.entries,
    source: 'reports',
    pages: reports.pages,
    truncated: reports.truncated,
    otherWorkspaceCount: 0,
  }
}
