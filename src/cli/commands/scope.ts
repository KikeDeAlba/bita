import { UsageError } from '../../errors.ts'
import { BASE_OPTIONS, parseCommandArgs, readBoolean } from '../args.ts'
import { createLocalContext } from '../local-context.ts'
import { findProjectById } from '../../db/projects.ts'
import { readConfig, setScopeMapping, unsetScopeMapping } from '../../state/config.ts'
import { resolveScopeForSlug } from '../../domain/repo.ts'
import { currentRepoIdentity } from './repo.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

async function resolvePrefix(raw: string): Promise<string> {
  if (raw !== '.') return raw.replace(/\/+$/, '')
  const identity = await currentRepoIdentity()
  if (!identity) throw new UsageError('Not inside a git repository, so "." cannot be resolved.')
  return identity.slug
}

export async function runScope(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'list'
  const args = parseCommandArgs(argv.slice(1), {}, BASE_OPTIONS)
  const json = readBoolean(args, 'json')

  if (subcommand === 'list') {
    const config = await readConfig()
    const rows = Object.entries(config.scopeMapping)
      .map(([prefix, mapping]) => ({ prefix, ...mapping }))
      .sort((left, right) => left.prefix.localeCompare(right.prefix))

    if (json) {
      writeJson(successEnvelope('scope list', rows))
      return 0
    }
    if (rows.length === 0) {
      writeOut('No scope is mapped to a project yet. Run "bita repo init" inside a repository.')
      return 0
    }

    writeOut(
      renderTable(
        [{ header: 'SCOPE' }, { header: 'PROJECT' }, { header: 'ID', align: 'right' }],
        rows.map((row) => [row.prefix, row.projectName, String(row.projectId)]),
      ),
    )
    writeOut('')
    writeOut('A repository resolves to the project of the longest scope that covers it.')
    return 0
  }

  if (subcommand === 'set') {
    const [rawPrefix, rawProjectId] = args.positionals
    if (!rawPrefix || !rawProjectId) {
      throw new UsageError('Usage: bita scope set <prefix|.> <projectId>')
    }

    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new UsageError(`Invalid project id: "${rawProjectId}".`)
    }

    const prefix = await resolvePrefix(rawPrefix)
    const ctx = createLocalContext(args)
    const project = findProjectById(ctx.db, projectId)
    ctx.db.close()
    if (!project) {
      throw new UsageError(`No project with id ${projectId}. Run "bita projects" to list them.`)
    }

    await setScopeMapping(prefix, {
      projectId,
      projectName: project.name,
      slugSource: 'path',
      verifiedAt: new Date().toISOString(),
    })

    if (json) {
      writeJson(successEnvelope('scope set', { prefix, projectId, projectName: project.name }))
    } else {
      writeOut(`Every repository under ${prefix} now resolves to ${project.name} (${projectId}).`)
    }
    return 0
  }

  if (subcommand === 'unset') {
    const [rawPrefix] = args.positionals
    if (!rawPrefix) throw new UsageError('Usage: bita scope unset <prefix|.>')

    const prefix = await resolvePrefix(rawPrefix)
    const removed = await unsetScopeMapping(prefix)

    if (json) writeJson(successEnvelope('scope unset', { prefix, removed }))
    else writeOut(removed ? `Removed the scope ${prefix}.` : `No scope existed for ${prefix}.`)
    return 0
  }

  if (subcommand === 'which') {
    const [rawSlug] = args.positionals
    const slug = await resolvePrefix(rawSlug ?? '.')
    const config = await readConfig()
    const match = resolveScopeForSlug(slug, config.scopeMapping)

    if (json) {
      writeJson(successEnvelope('scope which', { slug, match }))
      return 0
    }
    writeOut(
      match
        ? `${slug}\n  -> ${match.scope.projectName} (${match.scope.projectId}) via ${match.prefix}`
        : `${slug}\n  -> no scope covers it`,
    )
    return 0
  }

  throw new UsageError(`Unknown scope subcommand "${subcommand}". Use list, set, unset or which.`)
}
