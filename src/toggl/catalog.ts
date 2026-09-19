import type { TogglClient } from '../http/client.ts'
import type { WireClient, WireProject, WireTag, WireWorkspace } from './wire-types.ts'
import { readCache, writeCache } from '../state/cache.ts'
import { CATALOG_CACHE_TTL_MS } from '../config/constants.ts'

export interface Catalog {
  projects: Map<number, WireProject>
  clients: Map<number, WireClient>
  workspaces: Map<number, WireWorkspace>
  tagsById: Map<number, WireTag>
  tagsByName: Map<string, WireTag>
}

interface CatalogSnapshot {
  projects: WireProject[]
  clients: WireClient[]
  workspaces: WireWorkspace[]
  tags: WireTag[]
}

export interface LoadCatalogOptions {
  workspaceId: number
  refresh?: boolean
  now?: Date
}

function toCatalog(snapshot: CatalogSnapshot): Catalog {
  const tagsById = new Map<number, WireTag>()
  const tagsByName = new Map<string, WireTag>()

  for (const tag of snapshot.tags) {
    tagsById.set(tag.id, tag)
    tagsByName.set(tag.name.toLowerCase(), tag)
  }

  return {
    projects: new Map(snapshot.projects.map((project) => [project.id, project])),
    clients: new Map(snapshot.clients.map((client) => [client.id, client])),
    workspaces: new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace])),
    tagsById,
    tagsByName,
  }
}

export function emptyCatalog(): Catalog {
  return toCatalog({ projects: [], clients: [], workspaces: [], tags: [] })
}

async function fetchSnapshot(
  client: TogglClient,
  workspaceId: number,
): Promise<CatalogSnapshot> {
  const projects = await client.get<WireProject[] | null>('/me/projects', {
    query: { include_archived: 'true' },
  })
  const clients = await client.get<WireClient[] | null>('/me/clients')
  const workspaces = await client.get<WireWorkspace[] | null>('/me/workspaces')
  const tags = await client.get<WireTag[] | null>(`/workspaces/${workspaceId}/tags`)

  return {
    projects: projects.data ?? [],
    clients: clients.data ?? [],
    workspaces: workspaces.data ?? [],
    tags: tags.data ?? [],
  }
}

export async function loadCatalog(
  client: TogglClient,
  options: LoadCatalogOptions,
): Promise<Catalog> {
  const now = (options.now ?? new Date()).getTime()
  const cacheKey = `catalog-${options.workspaceId}.json`

  if (!options.refresh) {
    const cached = await readCache<CatalogSnapshot>(cacheKey, CATALOG_CACHE_TTL_MS, now)
    if (cached) return toCatalog(cached)
  }

  const snapshot = await fetchSnapshot(client, options.workspaceId)
  await writeCache(cacheKey, snapshot, now)
  return toCatalog(snapshot)
}

export interface ResolvedTags {
  ids: number[]
  unknown: string[]
}

export function resolveTagIds(catalog: Catalog, names: string[]): ResolvedTags {
  const ids: number[] = []
  const unknown: string[] = []

  for (const name of names) {
    const tag = catalog.tagsByName.get(name.toLowerCase())
    if (tag) ids.push(tag.id)
    else unknown.push(name)
  }

  return { ids, unknown }
}

export function canonicalizeTagNames(catalog: Catalog, names: string[]): string[] {
  return names.map((name) => catalog.tagsByName.get(name.toLowerCase())?.name ?? name)
}

export function unknownTagNames(catalog: Catalog, names: string[]): string[] {
  return names.filter((name) => !catalog.tagsByName.has(name.toLowerCase()))
}
