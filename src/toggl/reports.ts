import type { TogglClient } from '../http/client.ts'
import type { Catalog } from './catalog.ts'
import type { WireReportRow, WireTimeEntry } from './wire-types.ts'
import { REPORTS_MAX_PAGES, REPORTS_PAGE_SIZE } from '../config/constants.ts'

export interface ReportSearchParams {
  workspaceId: number
  startDate: string
  endDate: string
  userIds?: number[]
  projectIds?: number[]
  tagIds?: number[]
  pageSize?: number
}

export interface ReportSearchResult {
  rows: WireReportRow[]
  pages: number
  truncated: boolean
}

interface ReportRequestBody {
  start_date: string
  end_date: string
  page_size: number
  user_ids?: number[]
  project_ids?: number[]
  tag_ids?: number[]
  first_row_number?: number
  first_id?: number
}

export async function searchReportEntries(
  client: TogglClient,
  params: ReportSearchParams,
): Promise<ReportSearchResult> {
  const path = `/workspace/${params.workspaceId}/search/time_entries`
  const rows: WireReportRow[] = []

  let firstRowNumber: number | undefined
  let firstId: number | undefined
  let pages = 0

  while (pages < REPORTS_MAX_PAGES) {
    const body: ReportRequestBody = {
      start_date: params.startDate,
      end_date: params.endDate,
      page_size: params.pageSize ?? REPORTS_PAGE_SIZE,
    }
    if (params.userIds?.length) body.user_ids = params.userIds
    if (params.projectIds?.length) body.project_ids = params.projectIds
    if (params.tagIds?.length) body.tag_ids = params.tagIds
    if (firstRowNumber !== undefined) body.first_row_number = firstRowNumber
    if (firstId !== undefined) body.first_id = firstId

    const response = await client.post<WireReportRow[] | null>(path, body, { base: 'reports' })
    pages += 1
    rows.push(...(response.data ?? []))

    const nextRow = response.headers.get('x-next-row-number')
    const nextId = response.headers.get('x-next-id')
    if (!nextRow) return { rows, pages, truncated: false }

    firstRowNumber = Number(nextRow)
    firstId = nextId ? Number(nextId) : undefined
  }

  return { rows, pages, truncated: true }
}

export function normalizeReportRow(
  row: WireReportRow,
  context: { workspaceId: number; catalog: Catalog },
): WireTimeEntry[] {
  const tagIds = row.tag_ids ?? []
  const tags = tagIds
    .map((id) => context.catalog.tagsById.get(id)?.name)
    .filter((name): name is string => Boolean(name))

  return row.time_entries.map((inner) => ({
    id: inner.id,
    at: inner.at ?? inner.start,
    description: row.description,
    start: inner.start,
    stop: inner.stop,
    duration: inner.stop === null ? -Math.floor(Date.parse(inner.start) / 1000) : inner.seconds,
    billable: row.billable,
    project_id: row.project_id,
    task_id: row.task_id,
    tags,
    tag_ids: tagIds,
    user_id: row.user_id,
    workspace_id: context.workspaceId,
    client_id: row.client_id ?? null,
  }))
}

export function normalizeReportRows(
  rows: WireReportRow[],
  context: { workspaceId: number; catalog: Catalog },
): WireTimeEntry[] {
  return rows.flatMap((row) => normalizeReportRow(row, context))
}
