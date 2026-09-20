import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { withLocalContext } from '../local-context.ts'
import { runProjectDelete } from './delete.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import {
  findProjectById,
  findProjectByName,
  insertProject,
  renameProject,
  setProjectActive,
} from '../../db/projects.ts'

const OPTIONS = {
  client: { type: 'string' as const },
  activate: { type: 'boolean' as const, default: false },
  force: { type: 'boolean' as const, default: false },
  yes: { type: 'boolean' as const, default: false },
  'dry-run': { type: 'boolean' as const, default: false },
}

function requireProjectId(raw: string | undefined): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new UsageError(`"${raw ?? ''}" is not a project id. Run "bita projects" to see them.`)
  }
  return id
}

export async function runProject(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, OPTIONS)
  const [subcommand, ...rest] = args.positionals
  const json = readBoolean(args, 'json')

  if (subcommand === 'delete' || subcommand === 'rm') {
    return runProjectDelete(args, rest)
  }

  if (subcommand === 'add') {
    const name = rest.join(' ').trim()
    if (!name) throw new UsageError('Usage: bita project add "<name>" [--client "<name>"]')

    return withLocalContext(args, (ctx) => {
      const existing = findProjectByName(ctx.db, name)
      if (existing) {
        throw new UsageError(`A project named "${existing.name}" already exists (id ${existing.id}).`)
      }

      const created = insertProject(ctx.db, {
        name,
        clientName: readString(args, 'client') ?? null,
        createdAt: new Date().toISOString(),
      })

      if (json) {
        writeJson(successEnvelope('project add', created))
      } else {
        writeOut(`Created project ${created.id}: ${created.name}`)
        writeOut('')
        writeOut('To track time for a repository against it, from inside that repository:')
        writeOut(`  bita repo set . ${created.id}`)
      }
      return 0
    })
  }

  if (subcommand === 'rename') {
    const id = requireProjectId(rest[0])
    const name = rest.slice(1).join(' ').trim()
    if (!name) throw new UsageError('Usage: bita project rename <id> "<new name>"')

    return withLocalContext(args, (ctx) => {
      const project = findProjectById(ctx.db, id)
      if (!project) throw new UsageError(`No project with id ${id}.`)

      const clash = findProjectByName(ctx.db, name)
      if (clash && clash.id !== id) {
        throw new UsageError(`A project named "${clash.name}" already exists (id ${clash.id}).`)
      }

      renameProject(ctx.db, id, name)
      if (json) writeJson(successEnvelope('project rename', { id, from: project.name, to: name }))
      else writeOut(`Renamed ${id}: ${project.name} -> ${name}`)
      return 0
    })
  }

  if (subcommand === 'archive') {
    const id = requireProjectId(rest[0])
    const activate = readBoolean(args, 'activate')

    return withLocalContext(args, (ctx) => {
      const project = findProjectById(ctx.db, id)
      if (!project) throw new UsageError(`No project with id ${id}.`)

      setProjectActive(ctx.db, id, activate)
      if (json) writeJson(successEnvelope('project archive', { id, active: activate }))
      else writeOut(`${activate ? 'Reactivated' : 'Archived'} ${id}: ${project.name}`)
      return 0
    })
  }

  throw new UsageError(
    'Usage: bita project add|rename|archive|delete. To list them, run "bita projects".',
  )
}
