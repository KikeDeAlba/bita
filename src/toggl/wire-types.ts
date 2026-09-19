export interface WireTimeEntry {
  id: number
  at: string
  description: string | null
  start: string
  stop: string | null
  duration: number
  billable: boolean
  duronly?: boolean
  project_id: number | null
  task_id: number | null
  tags: string[] | null
  tag_ids: number[] | null
  user_id: number
  workspace_id: number
  client_id?: number | null
}

export interface WireMe {
  id: number
  email: string
  fullname: string
  default_workspace_id: number
  timezone: string
  beginning_of_week: number
}

export interface WireProject {
  id: number
  workspace_id: number
  client_id: number | null
  name: string
  active: boolean
  color?: string
}

export interface WireClient {
  id: number
  wid: number
  name: string
  archived?: boolean
}

export interface WireWorkspace {
  id: number
  name: string
  organization_id?: number
}

export interface WireTag {
  id: number
  workspace_id: number
  name: string
  at?: string
}

export interface WireBulkPatchResult {
  success: number[]
  failure: Array<{ id: number; message: string }>
}

export interface WireReportInnerEntry {
  id: number
  start: string
  stop: string | null
  seconds: number
  at?: string
}

export interface WireReportRow {
  user_id: number
  username?: string
  project_id: number | null
  task_id: number | null
  client_id?: number | null
  description: string | null
  tag_ids: number[] | null
  billable: boolean
  time_entries: WireReportInnerEntry[]
  row_number?: number
}
