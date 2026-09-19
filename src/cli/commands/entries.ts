import { parseCommandArgs, readBoolean } from '../args.ts'
import { createContext } from '../context.ts'
import { collectEntries } from '../collect.ts'
import { renderTable } from '../table.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { formatDuration } from '../../domain/duration.ts'

export async function runEntries(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, {})
  const ctx = await createContext(args)

  const result = await collectEntries(ctx, args, {
    includeRunning: true,
    requireDescription: false,
    requireProject: false,
  })

  const totalSeconds = result.selected.reduce((sum, entry) => sum + entry.durationSeconds, 0)

  if (readBoolean(args, 'json')) {
    writeJson(
      successEnvelope('entries', result.selected, {
        user: { id: ctx.me.id, email: ctx.me.email, timezone: ctx.timezone },
        workspace: { id: ctx.workspaceId, name: ctx.catalog.workspaces.get(ctx.workspaceId)?.name ?? null },
        range: { fromDay: result.range.fromDay, toDay: result.range.toDay, timezone: ctx.timezone },
        filters: { tags: result.filter.include, tagMode: result.filter.mode, excludeTags: result.filter.exclude },
        source: result.source,
        pages: result.pages,
        truncated: result.truncated,
        entryCount: result.selected.length,
        totalSeconds,
        totalHuman: formatDuration(totalSeconds),
        excluded: result.excluded,
        alreadyRegistered: result.alreadyRegistered,
        warnings: result.warnings,
      }),
    )
    for (const warning of result.warnings) writeErr(`Warning: ${warning}`)
    return 0
  }

  writeOut(
    renderTable(
      [
        { header: 'DAY' },
        { header: 'START' },
        { header: 'PROJECT' },
        { header: 'DESCRIPTION' },
        { header: 'TAGS' },
        { header: 'TIME', align: 'right' },
      ],
      result.selected.map((entry) => [
        entry.localDay,
        entry.startLocal.slice(11, 16),
        entry.projectName ?? '(no project)',
        entry.description || '(no description)',
        entry.tags.join(', '),
        entry.running ? `${entry.durationHuman} (running)` : entry.durationHuman,
      ]),
    ),
  )
  writeOut('')
  writeOut(`${result.selected.length} entries, ${formatDuration(totalSeconds)} total.`)
  for (const warning of result.warnings) writeErr(`Warning: ${warning}`)
  return 0
}
