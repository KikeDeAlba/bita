import { MissingTokenError } from '../http/errors.ts'
import { TOKEN_ENV_VAR } from '../config/constants.ts'
import { readKeychainToken, type KeychainDeps, type KeychainOptions } from './keychain.ts'

export type TokenSource = 'env' | 'keychain'

export interface ResolvedToken {
  token: string
  source: TokenSource
  masked: string
}

export interface ResolveTokenDeps {
  env?: NodeJS.ProcessEnv
  readToken?: (options?: KeychainOptions, deps?: KeychainDeps) => Promise<string | null>
}

export function maskToken(token: string): string {
  const tail = token.slice(-4)
  return `${'•'.repeat(8)}${tail}`
}

const MISSING_TOKEN_HINT = [
  'Run:',
  '  toggl auth login',
  '',
  'Or export a token for one-off use:',
  `  export ${TOKEN_ENV_VAR}=<your token>`,
  '',
  'Get your token at https://track.toggl.com/profile (bottom of the page).',
].join('\n')

export async function resolveToken(deps: ResolveTokenDeps = {}): Promise<ResolvedToken> {
  const env = deps.env ?? process.env
  const readToken = deps.readToken ?? readKeychainToken

  const fromEnv = env[TOKEN_ENV_VAR]?.trim()
  if (fromEnv) return { token: fromEnv, source: 'env', masked: maskToken(fromEnv) }

  const fromKeychain = await readToken()
  if (fromKeychain) return { token: fromKeychain, source: 'keychain', masked: maskToken(fromKeychain) }

  throw new MissingTokenError('No Toggl API token found.', MISSING_TOKEN_HINT)
}
