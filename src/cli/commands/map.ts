import { UsageError } from '../../http/errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { createContext } from '../context.ts'
import { readConfig, setProjectMapping, unsetProjectMapping } from '../../state/config.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/

export async function runMap(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'list'
  const args = parseCommandArgs(argv.slice(1), {
    'issue-type': { type: 'string' },
  })

  if (subcommand === 'list') {
    const config = await readConfig()
    const rows = Object.entries(config.projectMapping).map(([id, mapping]) => ({
      togglProjectId: Number(id),
      ...mapping,
    }))

    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('map list', rows, { jira: config.jira ?? null }))
      return 0
    }

    if (rows.length === 0) {
      writeOut('No Toggl project is mapped to a Jira project yet.')
      return 0
    }

    writeOut(
      renderTable(
        [
          { header: 'TOGGL ID' },
          { header: 'TOGGL PROJECT' },
          { header: 'JIRA' },
          { header: 'ISSUE TYPE' },
          { header: 'DONE TRANSITION' },
        ],
        rows.map((row) => [
          String(row.togglProjectId),
          row.togglProjectName,
          row.jiraProjectKey,
          row.issueTypeName ?? '',
          row.doneTransition?.name ?? '',
        ]),
      ),
    )
    return 0
  }

  if (subcommand === 'set') {
    const [rawProjectId, rawJiraKey] = args.positionals
    if (!rawProjectId || !rawJiraKey) {
      throw new UsageError('Usage: toggl map set <togglProjectId> <JIRAKEY> [--issue-type "Tarea"]')
    }

    const togglProjectId = Number(rawProjectId)
    if (!Number.isInteger(togglProjectId)) {
      throw new UsageError(`Invalid Toggl project id: "${rawProjectId}".`)
    }

    const jiraProjectKey = rawJiraKey.toUpperCase()
    if (!JIRA_KEY_PATTERN.test(jiraProjectKey)) {
      throw new UsageError(`Invalid Jira project key: "${rawJiraKey}". Expected something like DPF.`)
    }

    const ctx = await createContext(args)
    const project = ctx.catalog.projects.get(togglProjectId)
    if (!project) {
      throw new UsageError(
        `Toggl project ${togglProjectId} was not found in workspace ${ctx.workspaceId}. Run "toggl projects" to list them.`,
      )
    }

    const issueTypeName = readString(args, 'issue-type')
    await setProjectMapping(togglProjectId, {
      togglProjectName: project.name,
      jiraProjectKey,
      ...(issueTypeName !== undefined ? { issueTypeName } : {}),
      verifiedAt: new Date().toISOString(),
    })

    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('map set', { togglProjectId, togglProjectName: project.name, jiraProjectKey }))
    } else {
      writeOut(`Mapped "${project.name}" (${togglProjectId}) to Jira project ${jiraProjectKey}.`)
    }
    return 0
  }

  if (subcommand === 'unset') {
    const [rawProjectId] = args.positionals
    if (!rawProjectId) throw new UsageError('Usage: toggl map unset <togglProjectId>')

    const togglProjectId = Number(rawProjectId)
    if (!Number.isInteger(togglProjectId)) {
      throw new UsageError(`Invalid Toggl project id: "${rawProjectId}".`)
    }

    const removed = await unsetProjectMapping(togglProjectId)
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('map unset', { togglProjectId, removed }))
    } else {
      writeOut(removed ? `Removed the mapping for ${togglProjectId}.` : `No mapping existed for ${togglProjectId}.`)
    }
    return 0
  }

  throw new UsageError(`Unknown map subcommand "${subcommand}". Use list, set or unset.`)
}
