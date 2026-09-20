import { TogglClient } from '../../http/client.ts'
import { UsageError } from '../../errors.ts'
import {
  deleteKeychainToken,
  defaultAccount,
  readKeychainToken,
  writeKeychainToken,
} from '../../credentials/keychain.ts'
import { maskToken, resolveToken } from '../../credentials/token-provider.ts'
import { fetchMe } from '../../toggl/me.ts'
import { KEYCHAIN_SERVICE, TOKEN_ENV_VAR } from '../../config/constants.ts'
import { parseCommandArgs, readBoolean, readString, type ParsedArgs } from '../args.ts'
import { promptHidden } from '../prompt.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'

async function login(args: ParsedArgs): Promise<number> {
  const fromFlag = readString(args, 'token')
  const token = fromFlag ?? (await promptHidden('Toggl API token: '))

  if (!token) throw new UsageError('No token provided.')

  const client = new TogglClient({ token })
  const me = await fetchMe(client)

  await writeKeychainToken(token)

  const message = `Logged in as ${me.fullname} <${me.email}>, default workspace ${me.default_workspace_id}.`
  if (readBoolean(args, 'json')) {
    writeJson(
      successEnvelope('auth login', {
        userId: me.id,
        email: me.email,
        defaultWorkspaceId: me.default_workspace_id,
        timezone: me.timezone,
        storedIn: 'keychain',
      }),
    )
  } else {
    writeOut(message)
  }
  return 0
}

async function status(args: ParsedArgs): Promise<number> {
  const resolved = await resolveToken()
  const client = new TogglClient({ token: resolved.token })

  let reachable = false
  let email: string | null = null
  try {
    const me = await fetchMe(client)
    reachable = true
    email = me.email
  } catch {
    reachable = false
  }

  if (readBoolean(args, 'json')) {
    writeJson(
      successEnvelope('auth status', {
        source: resolved.source,
        masked: resolved.masked,
        reachable,
        email,
        keychainService: KEYCHAIN_SERVICE,
        keychainAccount: defaultAccount(),
      }),
    )
  } else {
    writeOut(`Token source : ${resolved.source}`)
    writeOut(`Token        : ${resolved.masked}`)
    writeOut(`Reachable    : ${reachable ? 'yes' : 'no'}`)
    if (email) writeOut(`Account      : ${email}`)
  }
  return reachable ? 0 : 4
}

async function logout(args: ParsedArgs): Promise<number> {
  const removed = await deleteKeychainToken()
  const stillInEnv = Boolean(process.env[TOKEN_ENV_VAR])

  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('auth logout', { removed, stillInEnv }))
  } else {
    writeOut(removed ? 'Removed the token from the keychain.' : 'No token was stored in the keychain.')
    if (stillInEnv) writeErr(`Warning: ${TOKEN_ENV_VAR} is still set in this shell.`)
  }
  return 0
}

export async function runAuth(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv.slice(1), { token: { type: 'string' } })
  const subcommand = argv[0] ?? 'status'

  switch (subcommand) {
    case 'login':
      return login(args)
    case 'status':
      return status(args)
    case 'logout':
      return logout(args)
    default:
      throw new UsageError(`Unknown auth subcommand "${subcommand}". Use login, status or logout.`)
  }
}

export { readKeychainToken, maskToken }
