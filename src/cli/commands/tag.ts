import { PartialWriteError, UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString, readStringList, type ParsedArgs } from '../args.ts'
import { createContext, type AppContext } from '../context.ts'
import { collectEntries } from '../collect.ts'
import { fetchEntriesByIds, fetchEntriesCoveringIds } from '../../toggl/time-entries.ts'
import { canonicalizeTagNames, unknownTagNames } from '../../toggl/catalog.ts'
import { buildTagPlan } from '../../domain/tag-plan.ts'
import { applyTagPlan, type MutationStrategy } from '../../toggl/mutations.ts'
import { appendJournal } from '../../state/journal.ts'
import { enrichEntries } from '../../domain/enrich.ts'
import { renderTable } from '../table.ts'
import { errorEnvelope, successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { promptConfirm } from '../prompt.ts'
import { EXIT_PARTIAL_WRITE } from '../exit-codes.ts'
import { MIN_REQUEST_INTERVAL_MS } from '../../config/constants.ts'
import type { EnrichedTimeEntry } from '../../domain/types.ts'

async function selectEntries(
  ctx: AppContext,
  args: ParsedArgs,
  ids: number[],
): Promise<EnrichedTimeEntry[]> {
  if (ids.length > 0) {
    const from = readString(args, 'from')
    const to = readString(args, 'to')

    if (from && to) {
      const entries = await fetchEntriesCoveringIds(ctx.client, {
        ids,
        workspaceId: ctx.workspaceId,
        userId: ctx.me.id,
        catalog: ctx.catalog,
        fromDay: from,
        toDay: to,
        timezone: ctx.timezone,
      })
      const found = new Set(entries.map((entry) => entry.id))
      const missing = ids.filter((id) => !found.has(id))
      if (missing.length > 0) {
        throw new UsageError(
          `These ids are not in the range ${from}..${to}: ${missing.join(', ')}. Widen --from/--to or drop them to read each id one by one.`,
        )
      }
      return enrichEntries(entries, ctx.catalog, ctx.timezone, ctx.now)
    }

    const entries = await fetchEntriesByIds(ctx.client, ids)
    return enrichEntries(entries, ctx.catalog, ctx.timezone, ctx.now)
  }

  const result = await collectEntries(ctx, args, {
    includeRunning: false,
    requireDescription: false,
    requireProject: false,
  })
  for (const warning of result.warnings) writeErr(`Warning: ${warning}`)
  return result.selected
}

export async function runTag(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, {
    add: { type: 'string', multiple: true },
    remove: { type: 'string', multiple: true },
    ids: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'no-verify': { type: 'boolean', default: false },
    strategy: { type: 'string' },
    'allow-running': { type: 'boolean', default: false },
  })

  const add = readStringList(args, 'add')
  const remove = readStringList(args, 'remove')
  if (add.length === 0 && remove.length === 0) {
    throw new UsageError('Nothing to do: pass --add and/or --remove with a tag name.')
  }

  const apply = readBoolean(args, 'apply')
  const dryRunFlag = readBoolean(args, 'dry-run')
  if (apply && dryRunFlag) throw new UsageError('Use either --apply or --dry-run, not both.')
  const dryRun = !apply

  const strategyFlag = args.values['strategy']
  if (strategyFlag !== undefined && strategyFlag !== 'patch' && strategyFlag !== 'put') {
    throw new UsageError(`Invalid value for --strategy: "${String(strategyFlag)}". Expected patch or put.`)
  }
  const strategy = (strategyFlag ?? 'patch') as MutationStrategy

  const ids = (args.values['ids'] as string | undefined)
    ? String(args.values['ids'])
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value))
    : args.positionals.map(Number).filter((value) => Number.isInteger(value))

  const ctx = await createContext(args)
  const candidates = await selectEntries(ctx, args, ids)

  const allowRunning = readBoolean(args, 'allow-running')
  const running = candidates.filter((entry) => entry.running)
  const entries = allowRunning ? candidates : candidates.filter((entry) => !entry.running)

  if (running.length > 0 && !allowRunning) {
    writeErr(
      `Warning: ${running.length} running entries were skipped. Stop the timer first, or pass --allow-running.`,
    )
  }

  const canonicalAdd = canonicalizeTagNames(ctx.catalog, add)
  const canonicalRemove = canonicalizeTagNames(ctx.catalog, remove)

  const createdByThisRun = unknownTagNames(ctx.catalog, add)
  if (createdByThisRun.length > 0) {
    writeErr(
      `Warning: these tags do not exist in this workspace and Toggl will create them: ${createdByThisRun.join(', ')}.`,
    )
  }

  const plan = buildTagPlan(entries, { add: canonicalAdd, remove: canonicalRemove }, ctx.workspaceId)
  const estimatedSeconds = Math.ceil((plan.requestCount * MIN_REQUEST_INTERVAL_MS) / 1000)

  const planPayload = {
    dryRun,
    add,
    remove,
    requested: entries.length,
    unchanged: plan.unchanged,
    requestCount: plan.requestCount,
    estimatedSeconds,
    batches: plan.batches,
  }

  if (dryRun) {
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('tag', planPayload, { dryRun: true, workspaceId: ctx.workspaceId }))
      return 0
    }
    if (plan.batches.length === 0) {
      writeOut('Nothing to change: every selected entry already has the desired tags.')
      return 0
    }
    writeOut(
      renderTable(
        [{ header: 'ENTRIES', align: 'right' }, { header: 'CURRENT' }, { header: 'DESIRED' }],
        plan.batches.map((batch) => [
          String(batch.ids.length),
          batch.currentTags.join(', ') || '(none)',
          batch.desiredTags.join(', ') || '(none)',
        ]),
      ),
    )
    writeOut('')
    writeOut(
      `Dry run: ${plan.requestCount} requests, about ${estimatedSeconds}s. ${plan.unchanged.length} entries already correct.`,
    )
    writeOut('Re-run with --apply to write these changes.')
    return 0
  }

  if (plan.batches.length === 0) {
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('tag', { ...planPayload, updated: [], failed: [] }, { dryRun: false }))
    } else {
      writeOut('Nothing to change: every selected entry already has the desired tags.')
    }
    return 0
  }

  if (!readBoolean(args, 'yes') && !readBoolean(args, 'json') && process.stdin.isTTY) {
    const affected = plan.batches.reduce((sum, batch) => sum + batch.ids.length, 0)
    const confirmed = await promptConfirm(`Apply tag changes to ${affected} entries?`)
    if (!confirmed) {
      writeOut('Cancelled. Nothing was written.')
      return 0
    }
  }

  const allIds = plan.batches.flatMap((batch) => batch.ids)
  const desiredTags = [...new Set(plan.batches.flatMap((batch) => batch.desiredTags))]

  await appendJournal({
    ts: new Date().toISOString(),
    phase: 'attempt',
    workspaceId: ctx.workspaceId,
    ids: allIds,
    desiredTags,
  })

  const result = await applyTagPlan(ctx.client, plan, {
    strategy,
    verify: !readBoolean(args, 'no-verify'),
    readEntries: (checkIds) => {
      const days = entries.filter((entry) => checkIds.includes(entry.id)).map((entry) => entry.localDay).sort()
      const fromDay = days[0]
      const toDay = days.at(-1)
      if (!fromDay || !toDay) return Promise.resolve([])
      return fetchEntriesCoveringIds(ctx.client, {
        ids: checkIds,
        workspaceId: ctx.workspaceId,
        userId: ctx.me.id,
        catalog: ctx.catalog,
        fromDay,
        toDay,
        timezone: ctx.timezone,
      })
    },
  })

  await appendJournal({
    ts: new Date().toISOString(),
    phase: 'result',
    workspaceId: ctx.workspaceId,
    ids: allIds,
    desiredTags,
    updated: result.updated,
    failed: result.failed.map((failure) => ({
      id: failure.id,
      message: failure.message,
      stage: failure.stage,
    })),
  })

  const payload = {
    dryRun: false,
    add,
    remove,
    updated: result.updated,
    unchanged: result.unchanged,
    failed: result.failed,
    strategy: result.strategy,
    verified: result.verified,
  }

  if (result.failed.length === 0) {
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('tag', payload, { dryRun: false, workspaceId: ctx.workspaceId }))
    } else {
      writeOut(`Updated ${result.updated.length} entries. ${result.unchanged.length} were already correct.`)
    }
    return 0
  }

  const failedIds = result.failed.map((failure) => failure.id)
  const repair = `toggl tag --ids ${failedIds.join(',')} ${add.map((tag) => `--add ${tag}`).join(' ')} ${remove
    .map((tag) => `--remove ${tag}`)
    .join(' ')} --apply --yes`

  if (readBoolean(args, 'json')) {
    writeJson(
      errorEnvelope(
        'tag',
        {
          code: 'PARTIAL_TAG_FAILURE',
          message: `${result.failed.length} of ${allIds.length} entries were not updated.`,
          hint: repair,
        },
        payload,
        { dryRun: false, workspaceId: ctx.workspaceId },
      ),
    )
  } else {
    writeErr('')
    writeErr('Tag update partially failed.')
    writeErr(`Updated (${result.updated.length}): ${result.updated.join(', ') || '(none)'}`)
    writeErr('FAILED. These entries keep their old tags, but their Jira worklogs may already exist.')
    writeErr('Do NOT re-run the Jira step for them.')
    for (const failure of result.failed) {
      writeErr(`  ${failure.id}  [${failure.stage}]  ${failure.message}`)
    }
    writeErr('')
    writeErr(`Retry only the tag update with:\n  ${repair}`)
  }

  throw new PartialWriteError(`${result.failed.length} entries were not updated.`)
}

export { EXIT_PARTIAL_WRITE }
