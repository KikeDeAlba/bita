import { parseCommandArgs, readBoolean } from '../args.ts'
import { createContext } from '../context.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export async function runProjects(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, {})
  const ctx = await createContext(args)

  const projects = [...ctx.catalog.projects.values()]
    .filter((project) => project.workspace_id === ctx.workspaceId)
    .map((project) => ({
      id: project.id,
      name: project.name,
      active: project.active,
      clientId: project.client_id,
      clientName: project.client_id === null ? null : (ctx.catalog.clients.get(project.client_id)?.name ?? null),
      jiraProjectKey: ctx.config.projectMapping[String(project.id)]?.jiraProjectKey ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('projects', projects))
    return 0
  }

  writeOut(
    renderTable(
      [
        { header: 'ID' },
        { header: 'PROJECT' },
        { header: 'CLIENT' },
        { header: 'ACTIVE' },
        { header: 'JIRA' },
      ],
      projects.map((project) => [
        String(project.id),
        project.name,
        project.clientName ?? '',
        project.active ? 'yes' : 'no',
        project.jiraProjectKey ?? '',
      ]),
    ),
  )
  return 0
}

export async function runTags(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, {})
  const ctx = await createContext(args)

  const tags = [...ctx.catalog.tagsById.values()]
    .map((tag) => ({ id: tag.id, name: tag.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('tags', tags))
    return 0
  }

  writeOut(
    renderTable(
      [{ header: 'ID' }, { header: 'TAG' }],
      tags.map((tag) => [String(tag.id), tag.name]),
    ),
  )
  return 0
}
