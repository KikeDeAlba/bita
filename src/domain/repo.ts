import path from 'node:path'
import type { RepoSlugSource } from '../state/config.ts'

export interface RepoIdentity {
  slug: string
  source: RepoSlugSource
  name: string
  branch?: string
  headSha?: string
}

export interface RepoIdentityInput {
  cwd: string
  toplevel: string | null
  home: string
  remoteUrl: string | null
  branch?: string | null
  headSha?: string | null
}

const DEV_ROOT = 'dev'

export function slugFromRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  if (trimmed.length === 0) return null

  const scpLike = trimmed.match(/^[^/@]+@([^:]+):(.+)$/)
  let host: string
  let repoPath: string

  if (scpLike?.[1] && scpLike[2]) {
    host = scpLike[1]
    repoPath = scpLike[2]
  } else {
    const withScheme = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i)
    if (!withScheme?.[1] || !withScheme[2]) return null
    host = withScheme[1]
    repoPath = withScheme[2]
  }

  const hostWithoutPort = host.replace(/:\d+$/, '')
  const cleanPath = repoPath.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  if (hostWithoutPort.length === 0 || cleanPath.length === 0) return null

  return `${hostWithoutPort}/${cleanPath}`.toLowerCase()
}

export function slugFromPath(toplevel: string, home: string): string | null {
  const devRoot = path.join(home, DEV_ROOT)
  const relative = path.relative(devRoot, toplevel)
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}

export function resolveRepoIdentity(input: RepoIdentityInput): RepoIdentity | null {
  const root = input.toplevel
  if (!root) return null

  const name = path.basename(root)
  const branch = input.branch ?? undefined
  const headSha = input.headSha ?? undefined
  const extras = {
    ...(branch !== undefined ? { branch } : {}),
    ...(headSha !== undefined ? { headSha } : {}),
  }

  const fromRemote = input.remoteUrl ? slugFromRemote(input.remoteUrl) : null
  if (fromRemote) return { slug: fromRemote, source: 'remote', name, ...extras }

  const fromPath = slugFromPath(root, input.home)
  if (fromPath) return { slug: fromPath, source: 'path', name, ...extras }

  return { slug: `local/${name}`, source: 'basename', name, ...extras }
}
