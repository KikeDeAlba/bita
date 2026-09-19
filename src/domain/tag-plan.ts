import type { EnrichedTimeEntry } from './types.ts'
import { BULK_PATCH_MAX_IDS } from '../config/constants.ts'

export interface TagChange {
  add: string[]
  remove: string[]
}

export interface TagBatch {
  ids: number[]
  currentTags: string[]
  desiredTags: string[]
}

export interface TagPlan {
  workspaceId: number
  batches: TagBatch[]
  unchanged: number[]
  requestCount: number
}

export function desiredTagsFor(currentTags: string[], change: TagChange): string[] {
  const removeLowered = change.remove.map((tag) => tag.toLowerCase())
  const kept = currentTags.filter((tag) => !removeLowered.includes(tag.toLowerCase()))
  const keptLowered = kept.map((tag) => tag.toLowerCase())
  const added = change.add.filter((tag) => !keptLowered.includes(tag.toLowerCase()))
  return [...kept, ...added]
}

function sameTagSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].map((tag) => tag.toLowerCase()).sort()
  const sortedRight = [...right].map((tag) => tag.toLowerCase()).sort()
  return sortedLeft.every((tag, index) => tag === sortedRight[index])
}

function signature(currentTags: string[], desiredTags: string[]): string {
  return `${[...currentTags].sort().join('\u0001')}\u0000${[...desiredTags].sort().join('\u0001')}`
}

export function buildTagPlan(
  entries: EnrichedTimeEntry[],
  change: TagChange,
  workspaceId: number,
): TagPlan {
  const unchanged: number[] = []
  const groups = new Map<string, TagBatch>()

  for (const entry of entries) {
    const desiredTags = desiredTagsFor(entry.tags, change)

    if (sameTagSet(entry.tags, desiredTags)) {
      unchanged.push(entry.id)
      continue
    }

    const key = signature(entry.tags, desiredTags)
    const group = groups.get(key)
    if (group) group.ids.push(entry.id)
    else groups.set(key, { ids: [entry.id], currentTags: entry.tags, desiredTags })
  }

  const batches: TagBatch[] = []
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.ids.length; offset += BULK_PATCH_MAX_IDS) {
      batches.push({
        ids: group.ids.slice(offset, offset + BULK_PATCH_MAX_IDS),
        currentTags: group.currentTags,
        desiredTags: group.desiredTags,
      })
    }
  }

  return { workspaceId, batches, unchanged, requestCount: batches.length }
}
