import { TogglClient } from '../http/client.ts'
import { resolveToken, type ResolvedToken } from '../credentials/token-provider.ts'
import { fetchMe } from '../toggl/me.ts'
import { loadCatalog, type Catalog } from '../toggl/catalog.ts'
import { readConfig, type AppConfig } from '../state/config.ts'
import type { WireMe } from '../toggl/wire-types.ts'
import { writeErr } from './output.ts'
import type { ParsedArgs } from './args.ts'
import { readBoolean, readInteger, readString } from './args.ts'

export interface AppContext {
  client: TogglClient
  token: ResolvedToken
  me: WireMe
  catalog: Catalog
  config: AppConfig
  workspaceId: number
  timezone: string
  now: Date
}

export async function createClient(args: ParsedArgs): Promise<{ client: TogglClient; token: ResolvedToken }> {
  const token = await resolveToken()
  const verbose = readBoolean(args, 'verbose')
  const options: ConstructorParameters<typeof TogglClient>[0] = { token: token.token }
  if (verbose) {
    options.onRequest = ({ method, url }): void => {
      writeErr(`[http] ${method} ${url}`)
    }
    options.onRetry = ({ attempt, delayMs }): void => {
      writeErr(`[http] retry ${attempt} in ${delayMs}ms`)
    }
  }
  return { client: new TogglClient(options), token }
}

export async function createContext(args: ParsedArgs): Promise<AppContext> {
  const { client, token } = await createClient(args)
  const me = await fetchMe(client)
  const config = await readConfig()

  const workspaceId = readInteger(args, 'workspace') ?? config.workspaceId ?? me.default_workspace_id
  const timezone = readString(args, 'timezone') ?? config.timezone ?? me.timezone

  const catalog = await loadCatalog(client, {
    workspaceId,
    refresh: readBoolean(args, 'no-cache'),
    now: new Date(),
  })

  return { client, token, me, catalog, config, workspaceId, timezone, now: new Date() }
}
