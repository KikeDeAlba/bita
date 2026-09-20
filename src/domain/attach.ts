export interface RunningSnapshot {
  id: number
  projectId: number | null
  isDraft: boolean
  elapsedSeconds: number
}

export type AttachDecision =
  | { kind: 'record'; entryId: number }
  | { kind: 'assign'; entryId: number; projectId: number }
  | { kind: 'split'; stopEntryId: number; projectId: number }
  | { kind: 'ignore'; reason: 'no-timer' | 'unknown-project' | 'too-short' }

export interface AttachInput {
  running: readonly RunningSnapshot[]
  projectId: number | null
  wrote: boolean
  minSplitSeconds: number
}

export function decideAttachment(input: AttachInput): AttachDecision {
  const { running, projectId, wrote, minSplitSeconds } = input

  const oldest = running[0]
  if (!oldest) return { kind: 'ignore', reason: 'no-timer' }

  if (projectId === null) {
    return wrote ? { kind: 'record', entryId: oldest.id } : { kind: 'ignore', reason: 'unknown-project' }
  }

  const sameProject = running.find((entry) => entry.projectId === projectId)
  if (sameProject) return { kind: 'record', entryId: sameProject.id }

  const unassigned = running.find((entry) => entry.projectId === null)
  if (unassigned) return { kind: 'assign', entryId: unassigned.id, projectId }

  if (!wrote) return { kind: 'ignore', reason: 'unknown-project' }

  const current = running[running.length - 1]
  if (!current) return { kind: 'ignore', reason: 'no-timer' }

  if (current.elapsedSeconds < minSplitSeconds) {
    return { kind: 'record', entryId: current.id }
  }

  return { kind: 'split', stopEntryId: current.id, projectId }
}
