import { TogglClient } from '../http/client.ts'
import { resolveToken, type ResolvedToken } from '../credentials/token-provider.ts'
import { loadCachedCatalog, type Catalog } from '../toggl/catalog.ts'
import { readConfig, writeConfig, type AppConfig } from '../state/config.ts'
import { fetchMe } from '../toggl/me.ts'
import { readCache } from '../state/cache.ts'
import type { WireMe } from '../toggl/wire-types.ts'
import { CATALOG_CACHE_TTL_MS } from '../config/constants.ts'
import { writeErr } from './output.ts'
import { readBoolean, readInteger, readString, type ParsedArgs } from './args.ts'

export interface LeanContext {
  client: TogglClient
  token: ResolvedToken
  config: AppConfig
  workspaceId: number
  timezone: string
  catalog: Catalog | null
  apiCalls: () => number
  now: Date
}

export async function createLeanContext(args: ParsedArgs): Promise<LeanContext> {
  const token = await resolveToken()
  const verbose = readBoolean(args, 'verbose')

  let calls = 0
  const options: ConstructorParameters<typeof TogglClient>[0] = {
    token: token.token,
    onRequest: ({ method, url }): void => {
      calls += 1
      if (verbose) writeErr(`[http] ${method} ${url}`)
    },
  }
  const client = new TogglClient(options)

  const config = await readConfig()
  const now = new Date()
  const cachedMe = await readCache<WireMe>('me.json', CATALOG_CACHE_TTL_MS, now.getTime())

  let workspaceId = readInteger(args, 'workspace') ?? config.workspaceId ?? cachedMe?.default_workspace_id
  let timezone =
    readString(args, 'timezone') ??
    config.timezone ??
    cachedMe?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone

  if (workspaceId === undefined) {
    const me = await fetchMe(client)
    workspaceId = me.default_workspace_id
    timezone = readString(args, 'timezone') ?? me.timezone
    config.workspaceId = workspaceId
    config.timezone = timezone
    await writeConfig(config)
  }

  const catalog = await loadCachedCatalog(workspaceId, now)

  return { client, token, config, workspaceId, timezone, catalog, apiCalls: () => calls, now }
}
