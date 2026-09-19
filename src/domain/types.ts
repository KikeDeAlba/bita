export interface EnrichedTimeEntry {
  id: number
  description: string
  projectId: number | null
  projectName: string | null
  clientId: number | null
  clientName: string | null
  workspaceId: number
  taskId: number | null
  tags: string[]
  tagIds: number[]
  billable: boolean
  start: string
  stop: string | null
  startLocal: string
  localDay: string
  durationSeconds: number
  durationHuman: string
  durationHours: number
  startedJira: string
  running: boolean
}

export interface WorklogSlice {
  entryId: number
  startedJira: string
  startLocal: string
  localDay: string
  durationSeconds: number
  timeSpent: string
  partial: boolean
}

export interface TaskGroup {
  key: string
  summary: string
  projectId: number | null
  projectName: string | null
  clientId: number | null
  clientName: string | null
  workspaceId: number
  billable: boolean
  totalSeconds: number
  totalHuman: string
  totalHours: number
  entryIds: number[]
  days: string[]
  firstStart: string
  lastStop: string | null
  worklogs: WorklogSlice[]
  partIndex: number
  partCount: number
  splitReason: 'none' | 'max-task-hours'
}

export interface ExcludedEntry {
  id: number
  description: string
  projectName: string | null
  localDay: string
  durationSeconds: number
  durationHuman: string
  tags: string[]
  reason: string
}
