import { readFile } from 'node:fs/promises'
import { ConflictError, UsageError } from '../../errors.ts'
import {
  BASE_OPTIONS,
  parseCommandArgs,
  readBoolean,
  readString,
  readStringList,
  type ParsedArgs,
} from '../args.ts'
import { createLocalContext, type LocalContext } from '../local-context.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { renderTable } from '../table.ts'
import { enrichEntry } from '../../domain/enrich.ts'
import { formatDuration } from '../../domain/duration.ts'
import { parseClockTime, parseDurationSeconds } from '../../domain/duration-input.ts'
import type { EnrichedTimeEntry } from '../../domain/types.ts'
import {
  countRunning,
  deleteEntry,
  findEntryById,
  insertEntry,
  listRunning,
  stopEntry,
} from '../../db/entries.ts'
import { findProjectByName, listProjects } from '../../db/projects.ts'
import type { EntryWithProjectRow } from '../../db/rows.ts'
import { appendNote, parseNoteInput, type NoteSource } from '../../state/notes.ts'
import { readConfig, setScopeMapping } from '../../state/config.ts'
import { currentRepoIdentity } from './repo.ts'
import { resolveMappedProject } from '../resolve-project.ts'
import { promptText } from '../prompt.ts'

const TIMER_OPTIONS = {
  project: { type: 'string' as const },
  'note-json': { type: 'string' as const },
  'note-file': { type: 'string' as const },
  file: { type: 'string' as const, multiple: true },
  command: { type: 'string' as const, multiple: true },
  resource: { type: 'string' as const, multiple: true },
  all: { type: 'boolean' as const, default: false },
  last: { type: 'boolean' as const, default: false },
  at: { type: 'string' as const },
  from: { type: 'string' as const },
  to: { type: 'string' as const },
  for: { type: 'string' as const },
  'require-running': { type: 'boolean' as const, default: false },
}

function requireTitle(args: ParsedArgs): string {
  const title = args.positionals.join(' ').trim()
  if (!title) throw new UsageError('A title is required: bita start "what you are doing".')
  return title
}

function enrich(ctx: LocalContext, row: EntryWithProjectRow): EnrichedTimeEntry {
  return enrichEntry(row, ctx.timezone, ctx.now)
}

async function resolveProjectId(
  ctx: LocalContext,
  args: ParsedArgs,
  json: boolean,
): Promise<number | null> {
  const raw = readString(args, 'project')
  if (raw) {
    const asNumber = Number(raw)
    if (Number.isInteger(asNumber) && asNumber > 0) return asNumber
    const match = findProjectByName(ctx.db, raw)
    if (!match) {
      throw new UsageError(`No project named "${raw}". Run "bita projects" to see them.`)
    }
    return match.id
  }

  const identity = await currentRepoIdentity()
  if (identity) {
    const config = await readConfig()
    const mapped = resolveMappedProject(identity.slug, config)
    if (mapped) return mapped.projectId
  }

  const candidates = listProjects(ctx.db).slice(0, 10)

  if (json || !process.stdin.isTTY || !identity) {
    throw new ConflictError(
      identity
        ? `No project is mapped to the repository "${identity.slug}".`
        : 'Not inside a mapped repository and no --project was given.',
      'REPO_NOT_MAPPED',
      identity ? `bita repo set ${identity.slug} <projectId>` : 'bita start "title" --project <id>',
    )
  }

  writeErr(`The repository "${identity.slug}" has no project yet.`)
  for (const [index, candidate] of candidates.entries()) {
    writeErr(`  ${index + 1}. ${candidate.name} (${candidate.id})`)
  }
  const answer = await promptText('Pick a number, or type a project id: ')
  const picked = Number(answer)
  if (!Number.isInteger(picked) || picked <= 0) throw new UsageError('No project chosen.')
  const fromList = candidates[picked - 1]
  const projectId = picked <= candidates.length && fromList ? fromList.id : picked

  await setScopeMapping(identity.slug, {
    projectId: projectId,
    projectName: listProjects(ctx.db, true).find((p) => p.id === projectId)?.name ?? String(projectId),
    slugSource: identity.source,
    verifiedAt: new Date().toISOString(),
  })
  return projectId
}

async function loadNoteBody(args: ParsedArgs): Promise<Record<string, unknown> | null> {
  const jsonPath = readString(args, 'note-json')
  const filePath = readString(args, 'note-file')
  const files = readStringList(args, 'file')
  const commands = readStringList(args, 'command')
  const resources = readStringList(args, 'resource')

  if (jsonPath) {
    try {
      return JSON.parse(await readFile(jsonPath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      throw new UsageError(`Could not read the note at ${jsonPath}: ${String(error)}`)
    }
  }

  if (filePath || files.length > 0 || commands.length > 0 || resources.length > 0) {
    const body = filePath ? await readFile(filePath, 'utf8') : ''
    return { body, artifacts: { files, commands, resources } }
  }

  return null
}

async function recordNote(
  entry: { id: number; description: string },
  raw: Record<string, unknown> | null,
  source: NoteSource,
): Promise<boolean> {
  if (!raw) return false
  const identity = await currentRepoIdentity()
  const note = parseNoteInput(raw, {
    entryId: entry.id,
    source,
    title: entry.description,
    recordedAt: new Date().toISOString(),
    ...(identity
      ? {
          repo: {
            slug: identity.slug,
            ...(identity.branch !== undefined ? { branch: identity.branch } : {}),
            ...(identity.headSha !== undefined ? { headSha: identity.headSha } : {}),
          },
        }
      : {}),
  })
  await appendNote(note)
  return true
}

export async function runStart(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const title = requireTitle(args)
  const ctx = createLocalContext(args)

  try {
    const projectId = await resolveProjectId(ctx, args, json)
    const at = readString(args, 'at')
    const startedAt = at === undefined ? ctx.now.toISOString() : parseClockTime(at, ctx.now, '--at').toISOString()

    const alreadyRunning = listRunning(ctx.db)
    const created = insertEntry(ctx.db, {
      description: title,
      projectId,
      startedAt,
      source: 'timer',
      now: ctx.now.toISOString(),
    })

    const row = listRunning(ctx.db).find((entry) => entry.id === created.id)
    const enriched = row ? enrich(ctx, row) : null

    if (json) {
      writeJson(
        successEnvelope('start', enriched, {
          alsoRunning: alreadyRunning.map((entry) => ({
            id: entry.id,
            description: entry.description,
          })),
          runningCount: countRunning(ctx.db),
        }),
      )
    } else {
      writeOut(`Started #${created.id}: ${title}`)
      if (enriched?.projectName) writeOut(`Project : ${enriched.projectName}`)
      writeOut(`Since   : ${enriched?.startLocal.slice(11, 16) ?? ''}`)
      if (alreadyRunning.length > 0) {
        writeOut('')
        writeOut(`Also running (${alreadyRunning.length}):`)
        for (const entry of alreadyRunning) writeOut(`  #${entry.id} ${entry.description}`)
      }
    }
    return 0
  } finally {
    ctx.db.close()
  }
}

export async function runStop(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const ctx = createLocalContext(args)

  try {
    const running = listRunning(ctx.db)

    if (running.length === 0) {
      if (readBoolean(args, 'require-running')) {
        throw new ConflictError('Nothing is running.', 'NO_RUNNING_TIMER', 'bita start "title"')
      }
      if (json) writeJson(successEnvelope('stop', null, { stopped: 0 }))
      else writeOut('Nothing is running.')
      return 0
    }

    const targets = await chooseTargets(ctx, args, running, json)
    const at = readString(args, 'at')
    const stoppedAt = at === undefined ? ctx.now.toISOString() : parseClockTime(at, ctx.now, '--at').toISOString()
    const noteBody = await loadNoteBody(args)

    const stopped: EnrichedTimeEntry[] = []
    for (const target of targets) {
      const snapshot = enrich(ctx, { ...target, stoppedAt })
      stopEntry(ctx.db, target.id, stoppedAt, ctx.now.toISOString())
      if (targets.length === 1) {
        await recordNote({ id: target.id, description: target.description }, noteBody, 'stop')
      }
      stopped.push(snapshot)
    }

    if (json) {
      writeJson(
        successEnvelope('stop', stopped, {
          stopped: stopped.length,
          stillRunning: countRunning(ctx.db),
          noteRecorded: targets.length === 1 && noteBody !== null,
        }),
      )
    } else {
      for (const entry of stopped) {
        writeOut(`Stopped #${entry.id}: ${entry.description} (${entry.durationHuman})`)
      }
      const left = countRunning(ctx.db)
      if (left > 0) writeOut(`${left} still running.`)
    }
    return 0
  } finally {
    ctx.db.close()
  }
}

async function chooseTargets(
  ctx: LocalContext,
  args: ParsedArgs,
  running: EntryWithProjectRow[],
  json: boolean,
): Promise<EntryWithProjectRow[]> {
  if (readBoolean(args, 'all')) return running

  const [positional] = args.positionals
  if (positional !== undefined) {
    const id = Number(positional)
    if (!Number.isInteger(id)) throw new UsageError(`"${positional}" is not an entry id.`)
    const match = running.find((entry) => entry.id === id)
    if (!match) throw new UsageError(`Entry #${id} is not running.`)
    return [match]
  }

  if (readBoolean(args, 'last')) {
    const last = running.at(-1)
    return last ? [last] : []
  }

  const only = running[0]
  if (running.length === 1 && only) return [only]

  if (json || !process.stdin.isTTY) {
    throw new ConflictError(
      `${running.length} timers are running; say which one.`,
      'AMBIGUOUS_TIMER',
      'bita stop <id>, bita stop --last or bita stop --all',
    )
  }

  writeErr(`${running.length} timers are running:`)
  for (const entry of running) {
    writeErr(`  #${entry.id} ${entry.description} (${enrich(ctx, entry).durationHuman})`)
  }
  const answer = await promptText('Which id? (or "all"): ')
  if (answer.trim().toLowerCase() === 'all') return running
  const id = Number(answer)
  const match = running.find((entry) => entry.id === id)
  if (!match) throw new UsageError(`Entry #${answer} is not running.`)
  return [match]
}

export function runCurrent(argv: string[]): number {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const ctx = createLocalContext(args)

  try {
    const running = listRunning(ctx.db).map((row) => enrich(ctx, row))
    const totalSeconds = running.reduce((sum, entry) => sum + entry.durationSeconds, 0)

    if (json) {
      writeJson(
        successEnvelope('current', running, {
          runningCount: running.length,
          totalSeconds,
          totalHuman: formatDuration(totalSeconds),
        }),
      )
      return 0
    }

    if (running.length === 0) {
      writeOut('Nothing is running.')
      return 0
    }

    writeOut(
      renderTable(
        [
          { header: 'ID', align: 'right' },
          { header: 'SINCE' },
          { header: 'PROJECT' },
          { header: 'DESCRIPTION' },
          { header: 'ELAPSED', align: 'right' },
        ],
        running.map((entry) => [
          String(entry.id),
          entry.startLocal.slice(11, 16),
          entry.projectName ?? '(no project)',
          entry.description,
          entry.durationHuman,
        ]),
      ),
    )
    if (running.length > 1) {
      writeOut('')
      writeOut(`${running.length} timers, ${formatDuration(totalSeconds)} of overlapping time.`)
    }
    return 0
  } finally {
    ctx.db.close()
  }
}

export async function runCancel(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const ctx = createLocalContext(args)

  try {
    const running = listRunning(ctx.db)
    if (running.length === 0) {
      if (json) writeJson(successEnvelope('cancel', null, { discarded: 0 }))
      else writeOut('Nothing is running.')
      return 0
    }

    const targets = await chooseTargets(ctx, args, running, json)
    const discarded = targets.map((target) => {
      const snapshot = enrich(ctx, target)
      deleteEntry(ctx.db, target.id)
      return snapshot
    })

    if (json) {
      writeJson(successEnvelope('cancel', discarded, { discarded: discarded.length }))
    } else {
      for (const entry of discarded) {
        writeOut(`Discarded #${entry.id}: ${entry.description} (${entry.durationHuman} lost)`)
      }
    }
    return 0
  } finally {
    ctx.db.close()
  }
}

export async function runLog(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const title = requireTitle(args)
  const ctx = createLocalContext(args)

  try {
    const projectId = await resolveProjectId(ctx, args, json)
    const rawFrom = readString(args, 'from')
    const rawTo = readString(args, 'to')
    const rawFor = readString(args, 'for')

    if (rawFrom === undefined) {
      throw new UsageError('bita log needs --from, plus either --to or --for.')
    }
    if (rawTo === undefined && rawFor === undefined) {
      throw new UsageError('bita log needs either --to or --for to know how long it lasted.')
    }

    const startedAt = parseClockTime(rawFrom, ctx.now, '--from').toISOString()
    const stoppedAt =
      rawTo !== undefined
        ? parseClockTime(rawTo, ctx.now, '--to').toISOString()
        : new Date(Date.parse(startedAt) + parseDurationSeconds(rawFor ?? '', '--for') * 1000).toISOString()

    if (Date.parse(stoppedAt) <= Date.parse(startedAt)) {
      throw new UsageError('The block ends before it starts.')
    }

    const created = insertEntry(ctx.db, {
      description: title,
      projectId,
      startedAt,
      stoppedAt,
      source: 'manual',
      now: ctx.now.toISOString(),
    })

    await recordNote(
      { id: created.id, description: created.description },
      await loadNoteBody(args),
      'log',
    )

    const row = findEntryById(ctx.db, created.id)
    const seconds = row ? Math.round((Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000) : 0

    if (json) {
      writeJson(successEnvelope('log', { ...created, durationSeconds: seconds }))
    } else {
      writeOut(`Logged #${created.id}: ${title} (${formatDuration(seconds)})`)
    }
    return 0
  } finally {
    ctx.db.close()
  }
}

