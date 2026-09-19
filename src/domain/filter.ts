import type { EnrichedTimeEntry } from './types.ts'

export type TagMatchMode = 'any' | 'all'

export interface TagFilter {
  include: string[]
  exclude: string[]
  mode: TagMatchMode
  untaggedOnly?: boolean
}

function lowered(values: string[]): string[] {
  return values.map((value) => value.toLowerCase())
}

export function matchesTagFilter(entry: { tags: string[] }, filter: TagFilter): boolean {
  const entryTags = lowered(entry.tags)

  if (filter.untaggedOnly) return entryTags.length === 0

  const excluded = lowered(filter.exclude)
  if (excluded.some((tag) => entryTags.includes(tag))) return false

  const included = lowered(filter.include)
  if (included.length === 0) return true

  return filter.mode === 'all'
    ? included.every((tag) => entryTags.includes(tag))
    : included.some((tag) => entryTags.includes(tag))
}

export function withinLocalRange(
  entry: EnrichedTimeEntry,
  fromDay: string,
  toDay: string,
): boolean {
  return entry.localDay >= fromDay && entry.localDay <= toDay
}
