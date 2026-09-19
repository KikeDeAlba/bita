import { parseCommandArgs, readBoolean, readInteger } from '../args.ts'
import { createContext } from '../context.ts'
import { collectEntries } from '../collect.ts'
import { groupEntries } from '../../domain/group.ts'
import { formatDuration } from '../../domain/duration.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { MAX_TASK_SECONDS } from '../../config/constants.ts'

export async function runSummary(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, {
    'case-insensitive': { type: 'boolean', default: false },
    'max-task-hours': { type: 'string' },
  })
  const ctx = await createContext(args)

  const result = await collectEntries(ctx, args, {
    includeRunning: readBoolean(args, 'include-running'),
    requireDescription: true,
    requireProject: false,
  })

  const maxTaskHours = readInteger(args, 'max-task-hours')
  const maxTaskSeconds = maxTaskHours === undefined ? MAX_TASK_SECONDS : maxTaskHours * 3600

  const groups = groupEntries(result.selected, {
    timezone: ctx.timezone,
    maxTaskSeconds,
    caseInsensitive: readBoolean(args, 'case-insensitive'),
  })

  const withMapping = groups.map((group) => ({
    ...group,
    jiraProjectKey:
      group.projectId === null
        ? null
        : (ctx.config.projectMapping[String(group.projectId)]?.jiraProjectKey ?? null),
  }))

  const unmappedProjects = [
    ...new Map(
      withMapping
        .filter((group) => group.projectId !== null && group.jiraProjectKey === null)
        .map((group) => [
          group.projectId,
          { togglProjectId: group.projectId, togglProjectName: group.projectName },
        ]),
    ).values(),
  ]

  const totalSeconds = groups.reduce((sum, group) => sum + group.totalSeconds, 0)
  const splitCount = groups.filter((group) => group.partCount > 1).length

  if (splitCount > 0) {
    result.warnings.push(
      `${splitCount} tasks were split to stay under the ${maxTaskSeconds / 3600}h per-task cap.`,
    )
  }

  if (readBoolean(args, 'json')) {
    writeJson(
      successEnvelope(
        'summary',
        { totalSeconds, totalHuman: formatDuration(totalSeconds), groups: withMapping },
        {
          user: { id: ctx.me.id, email: ctx.me.email, timezone: ctx.timezone },
          workspace: { id: ctx.workspaceId, name: ctx.catalog.workspaces.get(ctx.workspaceId)?.name ?? null },
          range: { fromDay: result.range.fromDay, toDay: result.range.toDay, timezone: ctx.timezone },
          filters: { tags: result.filter.include, tagMode: result.filter.mode, excludeTags: result.filter.exclude },
          jira: ctx.config.jira ?? null,
          source: result.source,
          pages: result.pages,
          truncated: result.truncated,
          entryCount: result.selected.length,
          groupCount: groups.length,
          maxTaskSeconds,
          excluded: result.excluded,
          alreadyRegistered: result.alreadyRegistered,
          unmappedProjects,
          warnings: result.warnings,
        },
      ),
    )
    for (const warning of result.warnings) writeErr(`Warning: ${warning}`)
    return 0
  }

  writeOut(
    renderTable(
      [
        { header: 'PROJECT' },
        { header: 'JIRA' },
        { header: 'SUMMARY' },
        { header: 'DAYS' },
        { header: 'LOGS', align: 'right' },
        { header: 'TIME', align: 'right' },
      ],
      withMapping.map((group) => [
        group.projectName ?? '(no project)',
        group.jiraProjectKey ?? '?',
        group.summary,
        group.days.length === 1 ? (group.days[0] ?? '') : `${group.days[0]} .. ${group.days.at(-1)}`,
        String(group.worklogs.length),
        group.totalHuman,
      ]),
    ),
  )
  writeOut('')
  writeOut(`${groups.length} tasks, ${result.selected.length} entries, ${formatDuration(totalSeconds)} total.`)

  if (result.excluded.length > 0) {
    writeOut('')
    writeOut('Excluded:')
    const byReason = new Map<string, number>()
    for (const entry of result.excluded) {
      byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1)
    }
    for (const [reason, count] of byReason) writeOut(`  ${count} ${reason}`)
  }

  if (unmappedProjects.length > 0) {
    writeOut('')
    writeOut('Toggl projects without a Jira project mapped:')
    for (const project of unmappedProjects) {
      writeOut(`  ${project.togglProjectId}  ${project.togglProjectName ?? '(unnamed)'}`)
    }
  }

  for (const warning of result.warnings) writeErr(`Warning: ${warning}`)
  return 0
}
