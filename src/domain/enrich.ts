import type { WireTimeEntry } from '../toggl/wire-types.ts'
import type { EnrichedTimeEntry } from './types.ts'
import type { Catalog } from '../toggl/catalog.ts'
import { elapsedSeconds, formatDuration, toDecimalHours } from './duration.ts'
import { localDay, toJiraStarted, toLocalIso } from './timezone.ts'

export function normalizeDescription(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

export function enrichEntry(
  entry: WireTimeEntry,
  catalog: Catalog,
  timezone: string,
  now: Date,
): EnrichedTimeEntry {
  const project = entry.project_id === null ? undefined : catalog.projects.get(entry.project_id)
  const clientId = entry.client_id ?? project?.client_id ?? null
  const client = clientId === null ? undefined : catalog.clients.get(clientId)
  const running = entry.duration < 0 || entry.stop === null
  const durationSeconds = elapsedSeconds(entry, now)
  const tagIds = entry.tag_ids ?? []
  const tags =
    entry.tags ??
    tagIds.map((id) => catalog.tagsById.get(id)?.name).filter((name): name is string => Boolean(name))

  return {
    id: entry.id,
    description: normalizeDescription(entry.description),
    projectId: entry.project_id,
    projectName: project?.name ?? null,
    clientId,
    clientName: client?.name ?? null,
    workspaceId: entry.workspace_id,
    taskId: entry.task_id,
    tags,
    tagIds,
    billable: entry.billable,
    start: entry.start,
    stop: entry.stop,
    startLocal: toLocalIso(entry.start, timezone),
    localDay: localDay(entry.start, timezone),
    durationSeconds,
    durationHuman: formatDuration(durationSeconds),
    durationHours: toDecimalHours(durationSeconds),
    startedJira: toJiraStarted(entry.start, timezone),
    running,
  }
}

export function enrichEntries(
  entries: WireTimeEntry[],
  catalog: Catalog,
  timezone: string,
  now: Date,
): EnrichedTimeEntry[] {
  return entries.map((entry) => enrichEntry(entry, catalog, timezone, now))
}
