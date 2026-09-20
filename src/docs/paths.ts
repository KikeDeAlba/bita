import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { UsageError } from '../errors.ts'
import { MEMORY_DB_PATH } from '../db/paths.ts'

export const DOCS_DIR_ENV_VAR = 'BITA_DOCS_DIR'

export function docsRoot(env: NodeJS.ProcessEnv = process.env, databaseLocation?: string): string {
  const override = env[DOCS_DIR_ENV_VAR]
  if (override) return override
  if (databaseLocation && databaseLocation !== MEMORY_DB_PATH) {
    return join(dirname(databaseLocation), 'docs')
  }
  const dataHome = env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share')
  return join(dataHome, 'bita', 'docs')
}

export function resolveDocPath(root: string, relPath: string): string {
  if (relPath.length === 0) throw new UsageError('A document path cannot be empty.')
  if (isAbsolute(relPath)) {
    throw new UsageError(`A document path must be relative to the docs root: "${relPath}".`)
  }

  const base = resolve(root)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new UsageError(`"${relPath}" escapes the docs root.`)
  }
  return target
}

export function relativeDocPath(root: string, absolutePath: string): string {
  const relPath = relative(resolve(root), resolve(absolutePath))
  if (relPath.length === 0 || relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new UsageError(`"${absolutePath}" is not inside the docs root.`)
  }
  return relPath.split(sep).join('/')
}
