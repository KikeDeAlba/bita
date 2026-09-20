import type { DatabaseSync } from 'node:sqlite'
import type { WireProject, WireTimeEntry } from '../toggl/wire-types.ts'
import type { Catalog } from '../toggl/catalog.ts'
import { insertEntry, findEntryByExternalId } from './entries.ts'
import { findProjectById, insertProject } from './projects.ts'
import { linkEntry } from './jira-links.ts'
import { inTransaction } from './open.ts'
import { REGISTERED_TAG } from '../config/constants.ts'

export interface ImportSummary {
  projectsCreated: number
  projectsSkipped: number
  entriesCreated: number
  entriesSkipped: number
  entriesLinked: number
  entriesRunning: number
}

export interface ImportInput {
  projects: WireProject[]
  entries: WireTimeEntry[]
  catalog: Catalog
  now: string
}

function tagNamesOf(entry: WireTimeEntry, catalog: Catalog): string[] {
  if (entry.tags) return entry.tags
  return (entry.tag_ids ?? [])
    .map((id) => catalog.tagsById.get(id)?.name)
    .filter((name): name is string => Boolean(name))
}

function isRegistered(entry: WireTimeEntry, catalog: Catalog): boolean {
  return tagNamesOf(entry, catalog).some((name) => name.toLowerCase() === REGISTERED_TAG)
}

export function importFromToggl(db: DatabaseSync, input: ImportInput): ImportSummary {
  const summary: ImportSummary = {
    projectsCreated: 0,
    projectsSkipped: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
    entriesLinked: 0,
    entriesRunning: 0,
  }

  inTransaction(db, () => {
    for (const project of input.projects) {
      if (findProjectById(db, project.id)) {
        summary.projectsSkipped += 1
        continue
      }
      const clientName =
        project.client_id === null || project.client_id === undefined
          ? null
          : (input.catalog.clients.get(project.client_id)?.name ?? null)
      insertProject(db, {
        id: project.id,
        name: project.name,
        clientName,
        active: project.active,
        externalId: project.id,
        createdAt: input.now,
      })
      summary.projectsCreated += 1
    }

    const ordered = [...input.entries].sort((left, right) => left.start.localeCompare(right.start))

    for (const entry of ordered) {
      if (findEntryByExternalId(db, entry.id)) {
        summary.entriesSkipped += 1
        continue
      }
      const running = entry.stop === null || entry.duration < 0
      if (running) summary.entriesRunning += 1

      const projectId =
        entry.project_id !== null && findProjectById(db, entry.project_id)
          ? entry.project_id
          : null

      const created = insertEntry(db, {
        description: (entry.description ?? '').trim().replace(/\s+/g, ' '),
        projectId,
        startedAt: entry.start,
        stoppedAt: running ? null : entry.stop,
        billable: entry.billable,
        source: 'import',
        externalId: entry.id,
        now: input.now,
      })
      summary.entriesCreated += 1

      if (isRegistered(entry, input.catalog)) {
        linkEntry(db, { entryId: created.id, issueKey: null, linkedAt: input.now })
        summary.entriesLinked += 1
      }
    }
  })

  return summary
}
