import type { TogglClient } from '../http/client.ts'
import type { WireTimeEntry } from './wire-types.ts'
import { TogglNotFoundError } from '../http/errors.ts'
import { CREATED_WITH } from '../config/constants.ts'

export interface StartEntryParams {
  workspaceId: number
  description: string
  start: Date
  projectId?: number | null
  tagIds?: number[]
  tagNames?: string[]
  billable?: boolean
}

interface StartEntryBody {
  workspace_id: number
  created_with: string
  description: string
  start: string
  duration: number
  project_id?: number | null
  tag_ids?: number[]
  tags?: string[]
  billable?: boolean
}

export function buildStartBody(params: StartEntryParams): StartEntryBody {
  const body: StartEntryBody = {
    workspace_id: params.workspaceId,
    created_with: CREATED_WITH,
    description: params.description,
    start: `${params.start.toISOString().slice(0, 19)}Z`,
    duration: -1,
  }

  if (params.projectId !== undefined) body.project_id = params.projectId
  if (params.tagIds && params.tagIds.length > 0) body.tag_ids = params.tagIds
  else if (params.tagNames && params.tagNames.length > 0) body.tags = params.tagNames
  if (params.billable !== undefined) body.billable = params.billable

  return body
}

export async function startEntry(
  client: TogglClient,
  params: StartEntryParams,
): Promise<WireTimeEntry> {
  const response = await client.post<WireTimeEntry>(
    `/workspaces/${params.workspaceId}/time_entries`,
    buildStartBody(params),
  )
  return response.data
}

export async function stopEntry(
  client: TogglClient,
  workspaceId: number,
  entryId: number,
): Promise<WireTimeEntry> {
  const response = await client.patch<WireTimeEntry>(
    `/workspaces/${workspaceId}/time_entries/${entryId}/stop`,
    undefined,
  )
  return response.data
}

export async function currentEntry(client: TogglClient): Promise<WireTimeEntry | null> {
  try {
    const response = await client.get<WireTimeEntry | null>('/me/time_entries/current')
    return response.data ?? null
  } catch (error) {
    if (error instanceof TogglNotFoundError) return null
    throw error
  }
}

export async function deleteEntry(
  client: TogglClient,
  workspaceId: number,
  entryId: number,
): Promise<void> {
  await client.delete<unknown>(`/workspaces/${workspaceId}/time_entries/${entryId}`)
}
