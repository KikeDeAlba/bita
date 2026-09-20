import type { TogglClient } from '../http/client.ts'
import type { WireMe } from './wire-types.ts'
import { readCache, writeCache } from '../state/cache.ts'
import { CATALOG_CACHE_TTL_MS } from '../config/constants.ts'
import { UsageError } from '../errors.ts'

const ME_CACHE_KEY = 'me.json'

export async function fetchMe(client: TogglClient): Promise<WireMe> {
  const response = await client.get<WireMe>('/me')
  return response.data
}

export interface ResolveMeOptions {
  refresh?: boolean
  offline?: boolean
  now?: Date
}

export async function resolveMe(client: TogglClient, options: ResolveMeOptions = {}): Promise<WireMe> {
  const now = (options.now ?? new Date()).getTime()

  if (!options.refresh) {
    const cached = await readCache<WireMe>(ME_CACHE_KEY, CATALOG_CACHE_TTL_MS, now)
    if (cached) return cached
  }

  if (options.offline) {
    throw new UsageError(
      'No cached account data and --offline was given. Run any command without --offline once to warm the cache.',
    )
  }

  const me = await fetchMe(client)
  await writeCache(ME_CACHE_KEY, me, now)
  return me
}
