import { execFile } from 'node:child_process'

export interface RepoContext {
  toplevel: string | null
  remoteUrl: string | null
  branch: string | null
  headSha: string | null
}

export type GitRunner = (args: string[], cwd: string) => Promise<string | null>

export interface GitDeps {
  run?: GitRunner
}

const GIT_TIMEOUT_MS = 3000

const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const value = stdout.trim()
      resolve(value.length > 0 ? value : null)
    })
  })

export async function readRepoContext(cwd: string, deps: GitDeps = {}): Promise<RepoContext> {
  const run = deps.run ?? runGit

  const toplevel = await run(['rev-parse', '--show-toplevel'], cwd)
  if (!toplevel) return { toplevel: null, remoteUrl: null, branch: null, headSha: null }

  const remoteUrl = await run(['remote', 'get-url', 'origin'], cwd)
  const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const headSha = await run(['rev-parse', '--short', 'HEAD'], cwd)

  return { toplevel, remoteUrl, branch, headSha }
}
