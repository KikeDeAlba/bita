import os from 'node:os'
import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, BASE_OPTIONS } from '../args.ts'
import { createLeanContext } from '../lean-context.ts'
import { readRepoContext } from '../../state/git.ts'
import { resolveRepoIdentity, type RepoIdentity } from '../../domain/repo.ts'
import { readConfig, setRepoMapping, unsetRepoMapping } from '../../state/config.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export async function currentRepoIdentity(cwd = process.cwd()): Promise<RepoIdentity | null> {
  const context = await readRepoContext(cwd)
  return resolveRepoIdentity({
    cwd,
    toplevel: context.toplevel,
    home: os.homedir(),
    remoteUrl: context.remoteUrl,
    branch: context.branch,
    headSha: context.headSha,
  })
}

export async function runRepo(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'show'
  const args = parseCommandArgs(argv.slice(1), {}, BASE_OPTIONS)
  const json = readBoolean(args, 'json')

  if (subcommand === 'show') {
    const identity = await currentRepoIdentity()
    const config = await readConfig()
    const mapping = identity ? config.repoMapping[identity.slug] : undefined

    if (json) {
      writeJson(successEnvelope('repo show', { repo: identity, mapping: mapping ?? null }))
      return 0
    }

    if (!identity) {
      writeOut('Not inside a git repository.')
      return 0
    }

    writeOut(`Slug    : ${identity.slug} (from ${identity.source})`)
    if (identity.branch) writeOut(`Branch  : ${identity.branch}`)
    writeOut(
      mapping
        ? `Project : ${mapping.togglProjectName} (${mapping.togglProjectId})`
        : `Project : not mapped. Run "toggl repo set . <togglProjectId>".`,
    )
    return 0
  }

  if (subcommand === 'list') {
    const config = await readConfig()
    const rows = Object.entries(config.repoMapping).map(([slug, mapping]) => ({ slug, ...mapping }))

    if (json) {
      writeJson(successEnvelope('repo list', rows))
      return 0
    }
    if (rows.length === 0) {
      writeOut('No repository is mapped to a Toggl project yet.')
      return 0
    }

    writeOut(
      renderTable(
        [{ header: 'REPOSITORY' }, { header: 'TOGGL PROJECT' }, { header: 'ID' }, { header: 'FROM' }],
        rows.map((row) => [row.slug, row.togglProjectName, String(row.togglProjectId), row.slugSource]),
      ),
    )
    return 0
  }

  if (subcommand === 'set') {
    const [rawSlug, rawProjectId] = args.positionals
    if (!rawSlug || !rawProjectId) {
      throw new UsageError('Usage: toggl repo set <slug|.> <togglProjectId>')
    }

    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId)) {
      throw new UsageError(`Invalid Toggl project id: "${rawProjectId}".`)
    }

    const identity = rawSlug === '.' ? await currentRepoIdentity() : null
    if (rawSlug === '.' && !identity) {
      throw new UsageError('Not inside a git repository, so "." cannot be resolved.')
    }
    const slug = rawSlug === '.' ? (identity as RepoIdentity).slug : rawSlug

    const ctx = await createLeanContext(args)
    const project = ctx.catalog?.projects.get(projectId)
    if (ctx.catalog && !project) {
      throw new UsageError(
        `Toggl project ${projectId} is not in the cached catalog. Run "toggl projects --no-cache" and try again.`,
      )
    }

    await setRepoMapping(slug, {
      togglProjectId: projectId,
      togglProjectName: project?.name ?? String(projectId),
      workspaceId: ctx.workspaceId,
      slugSource: identity?.source ?? 'path',
      verifiedAt: new Date().toISOString(),
    })

    if (json) {
      writeJson(successEnvelope('repo set', { slug, togglProjectId: projectId }))
    } else {
      writeOut(`Mapped ${slug} to ${project?.name ?? projectId} (${projectId}).`)
    }
    return 0
  }

  if (subcommand === 'unset') {
    const [rawSlug] = args.positionals
    if (!rawSlug) throw new UsageError('Usage: toggl repo unset <slug>')

    const identity = rawSlug === '.' ? await currentRepoIdentity() : null
    const slug = rawSlug === '.' && identity ? identity.slug : rawSlug
    const removed = await unsetRepoMapping(slug)

    if (json) writeJson(successEnvelope('repo unset', { slug, removed }))
    else writeOut(removed ? `Removed the mapping for ${slug}.` : `No mapping existed for ${slug}.`)
    return 0
  }

  throw new UsageError(`Unknown repo subcommand "${subcommand}". Use show, list, set or unset.`)
}
