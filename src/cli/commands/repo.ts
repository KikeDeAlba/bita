import os from 'node:os'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString, BASE_OPTIONS } from '../args.ts'
import { createLocalContext } from '../local-context.ts'
import { findProjectById, findProjectByName, insertProject } from '../../db/projects.ts'
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
  const args = parseCommandArgs(
    argv.slice(1),
    { name: { type: 'string' }, client: { type: 'string' } },
    BASE_OPTIONS,
  )
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
        ? `Project : ${mapping.projectName} (${mapping.projectId})`
        : `Project : not mapped. Run "bita repo init" to create one and map it.`,
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
      writeOut('No repository is mapped to a project yet.')
      return 0
    }

    writeOut(
      renderTable(
        [{ header: 'REPOSITORY' }, { header: 'PROJECT' }, { header: 'ID' }, { header: 'FROM' }],
        rows.map((row) => [row.slug, row.projectName, String(row.projectId), row.slugSource]),
      ),
    )
    return 0
  }

  if (subcommand === 'init') {
    const [rawPath] = args.positionals
    const target = rawPath === undefined || rawPath === '.' ? process.cwd() : resolve(rawPath)

    if (!existsSync(target)) {
      throw new UsageError(`No such directory: ${target}`)
    }

    const identity = await currentRepoIdentity(target)
    if (!identity) {
      throw new UsageError(`${target} is not inside a git repository.`)
    }

    const config = await readConfig()
    const existingMapping = config.repoMapping[identity.slug]
    if (existingMapping) {
      if (json) {
        writeJson(
          successEnvelope('repo init', {
            slug: identity.slug,
            projectId: existingMapping.projectId,
            projectName: existingMapping.projectName,
            created: false,
          }),
        )
      } else {
        writeOut(
          `${identity.slug} is already mapped to ${existingMapping.projectName} (${existingMapping.projectId}).`,
        )
        writeOut(`Run "bita repo unset ${identity.slug}" first if you want to change it.`)
      }
      return 0
    }

    const projectName = readString(args, 'name') ?? identity.name
    const ctx = createLocalContext(args)
    let project
    let created = false
    try {
      const found = findProjectByName(ctx.db, projectName)
      if (found) {
        project = found
      } else {
        project = insertProject(ctx.db, {
          name: projectName,
          clientName: readString(args, 'client') ?? null,
          createdAt: new Date().toISOString(),
        })
        created = true
      }
    } finally {
      ctx.db.close()
    }

    await setRepoMapping(identity.slug, {
      projectId: project.id,
      projectName: project.name,
      slugSource: identity.source,
      verifiedAt: new Date().toISOString(),
    })

    if (json) {
      writeJson(
        successEnvelope('repo init', {
          slug: identity.slug,
          projectId: project.id,
          projectName: project.name,
          created,
        }),
      )
    } else {
      writeOut(
        created
          ? `Created project ${project.id}: ${project.name}`
          : `Reused the existing project ${project.id}: ${project.name}`,
      )
      writeOut(`Mapped ${identity.slug} (from ${identity.source}) to it.`)
      writeOut('')
      writeOut('Claude will now offer the timer in this repository.')
      writeOut(`To send its time to a Jira board: bita map set ${project.id} <JIRAKEY>`)
    }
    return 0
  }

  if (subcommand === 'set') {
    const [rawSlug, rawProjectId] = args.positionals
    if (!rawSlug || !rawProjectId) {
      throw new UsageError('Usage: bita repo set <slug|.> <projectId>')
    }

    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId)) {
      throw new UsageError(`Invalid project id: "${rawProjectId}".`)
    }

    const identity = rawSlug === '.' ? await currentRepoIdentity() : null
    if (rawSlug === '.' && !identity) {
      throw new UsageError('Not inside a git repository, so "." cannot be resolved.')
    }
    const slug = rawSlug === '.' ? (identity as RepoIdentity).slug : rawSlug

    const ctx = createLocalContext(args)
    const project = findProjectById(ctx.db, projectId)
    ctx.db.close()
    if (!project) {
      throw new UsageError(`No project with id ${projectId}. Run "bita projects" to list them.`)
    }

    await setRepoMapping(slug, {
      projectId: projectId,
      projectName: project.name,
      slugSource: identity?.source ?? 'path',
      verifiedAt: new Date().toISOString(),
    })

    if (json) {
      writeJson(successEnvelope('repo set', { slug, projectId: projectId }))
    } else {
      writeOut(`Mapped ${slug} to ${project?.name ?? projectId} (${projectId}).`)
    }
    return 0
  }

  if (subcommand === 'unset') {
    const [rawSlug] = args.positionals
    if (!rawSlug) throw new UsageError('Usage: bita repo unset <slug>')

    const identity = rawSlug === '.' ? await currentRepoIdentity() : null
    const slug = rawSlug === '.' && identity ? identity.slug : rawSlug
    const removed = await unsetRepoMapping(slug)

    if (json) writeJson(successEnvelope('repo unset', { slug, removed }))
    else writeOut(removed ? `Removed the mapping for ${slug}.` : `No mapping existed for ${slug}.`)
    return 0
  }

  throw new UsageError(`Unknown repo subcommand "${subcommand}". Use init, show, list, set or unset.`)
}
