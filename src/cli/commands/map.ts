import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { createContext } from '../context.ts'
import { readConfig, setProjectMapping, setStory, unsetProjectMapping } from '../../state/config.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/
const PARENT_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/

export async function runMap(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'list'
  const args = parseCommandArgs(argv.slice(1), {
    'issue-type': { type: 'string' },
    summary: { type: 'string' },
    epic: { type: 'string' },
    parent: { type: 'string' },
    'no-epic': { type: 'boolean', default: false },
    hierarchy: { type: 'string' },
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
          { header: 'PARENT' },
          { header: 'ISSUE TYPE' },
          { header: 'DONE TRANSITION' },
        ],
        rows.map((row) => [
          String(row.togglProjectId),
          row.togglProjectName,
          row.jiraProjectKey,
          row.parentKey ?? '',
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
    const rawParent = readString(args, 'parent') ?? readString(args, 'epic')
    const parentKey = rawParent === undefined ? undefined : rawParent.toUpperCase()

    if (parentKey !== undefined) {
      if (!PARENT_KEY_PATTERN.test(parentKey)) {
        throw new UsageError(`Invalid parent key: "${rawParent}". Expected something like INN-1213.`)
      }
      const parentProject = parentKey.slice(0, parentKey.lastIndexOf('-'))
      if (parentProject !== jiraProjectKey) {
        throw new UsageError(
          `Parent ${parentKey} belongs to project ${parentProject}, not ${jiraProjectKey}. An issue cannot sit under a parent from another project.`,
        )
      }
    }

    const noEpic = readBoolean(args, 'no-epic')
    const rawHierarchy = readString(args, 'hierarchy')
    if (
      rawHierarchy !== undefined &&
      rawHierarchy !== 'epic-story-subtask' &&
      rawHierarchy !== 'story-subtask' &&
      rawHierarchy !== 'flat-task'
    ) {
      throw new UsageError(
        `Invalid --hierarchy: "${rawHierarchy}". Use epic-story-subtask, story-subtask or flat-task.`,
      )
    }
    const hierarchy =
      rawHierarchy ?? (parentKey !== undefined ? 'epic-story-subtask' : noEpic ? 'story-subtask' : undefined)

    await setProjectMapping(togglProjectId, {
      togglProjectName: project.name,
      jiraProjectKey,
      ...(parentKey !== undefined ? { parentKey } : {}),
      ...(hierarchy !== undefined ? { hierarchy } : {}),
      ...(parentKey !== undefined || noEpic ? { epicResolved: true } : {}),
      ...(issueTypeName !== undefined ? { issueTypeName } : {}),
      verifiedAt: new Date().toISOString(),
    })

    if (readBoolean(args, 'json')) {
      writeJson(
        successEnvelope('map set', {
          togglProjectId,
          togglProjectName: project.name,
          jiraProjectKey,
          parentKey: parentKey ?? null,
        }),
      )
    } else {
      const under = parentKey ? ` under ${parentKey}` : ''
      writeOut(`Mapped "${project.name}" (${togglProjectId}) to Jira project ${jiraProjectKey}${under}.`)
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

  if (subcommand === 'story') {
    const [rawProjectId, themeId, rawIssueKey] = args.positionals
    if (!rawProjectId || !themeId || !rawIssueKey) {
      throw new UsageError('Usage: toggl map story <togglProjectId> <themeId> <ISSUE-KEY>')
    }

    const togglProjectId = Number(rawProjectId)
    if (!Number.isInteger(togglProjectId)) {
      throw new UsageError(`Invalid Toggl project id: "${rawProjectId}".`)
    }

    const issueKey = rawIssueKey.toUpperCase()
    if (!PARENT_KEY_PATTERN.test(issueKey)) {
      throw new UsageError(`Invalid issue key: "${rawIssueKey}". Expected something like INN-1230.`)
    }

    await setStory(togglProjectId, themeId, {
      key: issueKey,
      summary: readString(args, 'summary') ?? themeId,
      verifiedAt: new Date().toISOString(),
    })

    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('map story', { togglProjectId, themeId, issueKey }))
    } else {
      writeOut(`Theme "${themeId}" of project ${togglProjectId} now points at ${issueKey}.`)
    }
    return 0
  }

  throw new UsageError(`Unknown map subcommand "${subcommand}". Use list, set, unset or story.`)
}
