import { readFile } from 'node:fs/promises'
import { ConflictError, TogglNotFoundError, UsageError } from '../../http/errors.ts'
import { BASE_OPTIONS, parseCommandArgs, readBoolean, readInteger, readString, readStringList, type ParsedArgs } from '../args.ts'
import { createLeanContext, type LeanContext } from '../lean-context.ts'
import { currentEntry, deleteEntry, startEntry, stopEntry } from '../../toggl/timer.ts'
import { canonicalizeTagNames, emptyCatalog } from '../../toggl/catalog.ts'
import { enrichEntry } from '../../domain/enrich.ts'
import { isMirrorFresh, readRunningMirror, writeRunningMirror } from '../../state/running.ts'
import { appendNote, parseNoteInput, type NoteSource } from '../../state/notes.ts'
import { currentRepoIdentity } from './repo.ts'
import { writeConfig } from '../../state/config.ts'
import { promptConfirm, promptText } from '../prompt.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { formatDuration } from '../../domain/duration.ts'
import type { WireTimeEntry } from '../../toggl/wire-types.ts'
import type { EnrichedTimeEntry } from '../../domain/types.ts'
import { PENDING_TAG, PENDING_TAG_FALLBACK, TITLE_HARD_MAX, TITLE_SOFT_MAX } from '../../config/constants.ts'

const TIMER_OPTIONS = {
  title: { type: 'string' as const },
  project: { type: 'string' as const },
  'no-pending': { type: 'boolean' as const, default: false },
  billable: { type: 'boolean' as const, default: false },
  switch: { type: 'boolean' as const, default: false },
  force: { type: 'boolean' as const, default: false },
  check: { type: 'boolean' as const, default: false },
  id: { type: 'string' as const },
  'note-json': { type: 'string' as const },
  'note-file': { type: 'string' as const },
  file: { type: 'string' as const, multiple: true },
  command: { type: 'string' as const, multiple: true },
  resource: { type: 'string' as const, multiple: true },
  'require-running': { type: 'boolean' as const, default: false },
  yes: { type: 'boolean' as const, default: false },
  tag: { type: 'string' as const, multiple: true },
}

function enrich(ctx: LeanContext, entry: WireTimeEntry): EnrichedTimeEntry {
  return enrichEntry(entry, ctx.catalog ?? emptyCatalog(), ctx.timezone, ctx.now)
}

function requireTitle(args: ParsedArgs): string {
  const title = (readString(args, 'title') ?? args.positionals.join(' ')).trim()
  if (title.length < 3) {
    throw new UsageError(
      'A timer needs a title of at least 3 characters: it becomes the Jira summary and the grouping key.',
    )
  }
  if (title.length > TITLE_HARD_MAX) {
    throw new UsageError(`The title is ${title.length} characters; keep it under ${TITLE_HARD_MAX}.`)
  }
  if (title.length > TITLE_SOFT_MAX) {
    writeErr(`Warning: the title is ${title.length} characters. Short titles read better in Jira.`)
  }
  return title
}

interface PendingTag {
  tagIds?: number[]
  tagNames?: string[]
}

async function resolvePendingTag(ctx: LeanContext, extra: string[]): Promise<PendingTag> {
  const wanted = [PENDING_TAG, ...extra]

  if (ctx.catalog) {
    const ids: number[] = []
    const missing: string[] = []
    for (const name of wanted) {
      const tag = ctx.catalog.tagsByName.get(name.toLowerCase())
      if (tag) ids.push(tag.id)
      else missing.push(name)
    }
    if (missing.length === 0) {
      const canonical = canonicalizeTagNames(ctx.catalog, [PENDING_TAG])[0]
      if (canonical && ctx.config.defaults?.pendingTagName !== canonical) {
        ctx.config.defaults = { ...ctx.config.defaults, pendingTagName: canonical }
        await writeConfig(ctx.config)
      }
      return { tagIds: ids }
    }
    return { tagNames: canonicalizeTagNames(ctx.catalog, wanted) }
  }

  const remembered = ctx.config.defaults?.pendingTagName
  if (remembered) return { tagNames: [remembered, ...extra] }

  throw new UsageError(
    `No tag catalog is cached, so "${PENDING_TAG_FALLBACK}" might be created a second time in lowercase. Run "toggl tags" once and try again.`,
  )
}

async function resolveProjectId(ctx: LeanContext, args: ParsedArgs, json: boolean): Promise<number | null> {
  const raw = readString(args, 'project')
  if (raw) {
    const asNumber = Number(raw)
    if (Number.isInteger(asNumber)) return asNumber
    const matches = [...(ctx.catalog?.projects.values() ?? [])].filter(
      (project) => project.name.toLowerCase() === raw.toLowerCase(),
    )
    const match = matches[0]
    if (matches.length !== 1 || !match) {
      throw new UsageError(`Could not resolve the project "${raw}" to a single id. Pass --project <id>.`)
    }
    return match.id
  }

  const identity = await currentRepoIdentity()
  if (identity) {
    const mapped = ctx.config.repoMapping[identity.slug]
    if (mapped) return mapped.togglProjectId
  }

  const candidates = [...(ctx.catalog?.projects.values() ?? [])]
    .filter((project) => project.active)
    .slice(0, 10)
    .map((project) => ({ id: project.id, name: project.name }))

  if (json || !process.stdin.isTTY || !identity) {
    throw new ConflictError(
      identity
        ? `No Toggl project is mapped to the repository "${identity.slug}".`
        : 'Not inside a mapped repository and no --project was given.',
      'REPO_NOT_MAPPED',
      identity ? `toggl repo set ${identity.slug} <togglProjectId>` : 'toggl start "title" --project <id>',
    )
  }

  writeErr(`The repository "${identity.slug}" has no Toggl project yet.`)
  for (const [index, candidate] of candidates.entries()) {
    writeErr(`  ${index + 1}. ${candidate.name} (${candidate.id})`)
  }
  const answer = await promptText('Pick a number, or type a Toggl project id: ')
  const picked = Number(answer)
  if (!Number.isInteger(picked) || picked <= 0) throw new UsageError('No project chosen.')
  const fromList = candidates[picked - 1]
  const projectId = picked <= candidates.length && fromList ? fromList.id : picked

  const { setRepoMapping } = await import('../../state/config.ts')
  await setRepoMapping(identity.slug, {
    togglProjectId: projectId,
    togglProjectName: ctx.catalog?.projects.get(projectId)?.name ?? String(projectId),
    workspaceId: ctx.workspaceId,
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
  ctx: LeanContext,
  entry: WireTimeEntry,
  raw: Record<string, unknown> | null,
  source: NoteSource,
): Promise<boolean> {
  if (!raw) return false
  const identity = await currentRepoIdentity()
  const note = parseNoteInput(raw, {
    entryId: entry.id,
    workspaceId: entry.workspace_id,
    source,
    title: entry.description ?? '',
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

async function mirrorFrom(entry: WireTimeEntry | null): Promise<void> {
  if (!entry) {
    await writeRunningMirror({ state: 'idle', writtenAt: new Date().toISOString() })
    return
  }
  await writeRunningMirror({
    state: 'running',
    writtenAt: new Date().toISOString(),
    entryId: entry.id,
    workspaceId: entry.workspace_id,
    projectId: entry.project_id,
    description: entry.description ?? '',
    start: entry.start,
    tags: entry.tags ?? [],
  })
}

export async function runStart(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const title = requireTitle(args)
  const ctx = await createLeanContext(args)

  const mirror = await readRunningMirror()
  const trustMirror = mirror !== null && isMirrorFresh(mirror, ctx.now) && !readBoolean(args, 'check')
  let running: WireTimeEntry | null = null

  if (trustMirror && mirror.state === 'running') {
    if (!readBoolean(args, 'switch') && !readBoolean(args, 'force')) {
      throw new ConflictError(
        `A timer is already running: ${mirror.entryId} "${mirror.description ?? ''}" since ${mirror.start ?? 'unknown'}.`,
        'TIMER_ALREADY_RUNNING',
        'Stop it with "toggl stop", or start this one with "toggl start --switch".',
      )
    }
    if (mirror.entryId && mirror.workspaceId) {
      await stopEntry(ctx.client, mirror.workspaceId, mirror.entryId)
    }
  } else if (!trustMirror && !readBoolean(args, 'force')) {
    running = await currentEntry(ctx.client)
    if (running) {
      if (!readBoolean(args, 'switch')) {
        throw new ConflictError(
          `A timer is already running: ${running.id} "${running.description ?? ''}" since ${running.start}.`,
          'TIMER_ALREADY_RUNNING',
          'Stop it with "toggl stop", or start this one with "toggl start --switch".',
        )
      }
      await stopEntry(ctx.client, running.workspace_id, running.id)
    }
  }

  const projectId = await resolveProjectId(ctx, args, json)
  const tag = readBoolean(args, 'no-pending')
    ? { tagNames: readStringList(args, 'tag') }
    : await resolvePendingTag(ctx, readStringList(args, 'tag'))

  const entry = await startEntry(ctx.client, {
    workspaceId: ctx.workspaceId,
    description: title,
    start: new Date(),
    projectId,
    billable: readBoolean(args, 'billable'),
    ...tag,
  })

  await mirrorFrom(entry)
  const noteRecorded = await recordNote(ctx, entry, await loadNoteBody(args), 'start')
  const enriched = enrich(ctx, entry)

  if (json) {
    writeJson(
      successEnvelope('start', { ...enriched, noteRecorded }, { apiCalls: ctx.apiCalls(), workspaceId: ctx.workspaceId }),
    )
    return 0
  }

  writeOut(`Started  ${entry.id}  ${enriched.description}`)
  writeOut(`Project  ${enriched.projectName ?? '(no project)'}`)
  writeOut(`Tags     ${enriched.tags.join(', ') || '(none)'}`)
  writeOut(`Since    ${enriched.startLocal.slice(0, 16).replace('T', ' ')}`)
  return 0
}

export async function runStop(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const ctx = await createLeanContext(args)

  const explicitId = readInteger(args, 'id')
  const mirror = await readRunningMirror()
  let stopped: WireTimeEntry | null = null

  const candidateId = explicitId ?? (mirror?.state === 'running' ? mirror.entryId : undefined)
  const candidateWorkspace = mirror?.workspaceId ?? ctx.workspaceId

  if (candidateId) {
    try {
      stopped = await stopEntry(ctx.client, candidateWorkspace, candidateId)
    } catch (error) {
      if (!(error instanceof TogglNotFoundError)) throw error
      stopped = null
    }
  }

  if (!stopped) {
    const running = await currentEntry(ctx.client)
    if (running) stopped = await stopEntry(ctx.client, running.workspace_id, running.id)
  }

  if (!stopped) {
    await mirrorFrom(null)
    if (readBoolean(args, 'require-running')) {
      throw new ConflictError('No timer is running.', 'NO_RUNNING_ENTRY', 'Start one with "toggl start".')
    }
    if (json) writeJson(successEnvelope('stop', { stopped: false, reason: 'no-running-entry' }))
    else writeOut('No timer is running.')
    return 0
  }

  await mirrorFrom(null)
  const noteRecorded = await recordNote(ctx, stopped, await loadNoteBody(args), 'stop')
  const enriched = enrich(ctx, stopped)

  if (json) {
    writeJson(
      successEnvelope(
        'stop',
        { ...enriched, stopped: true, noteRecorded },
        { apiCalls: ctx.apiCalls(), workspaceId: ctx.workspaceId },
      ),
    )
    return 0
  }

  writeOut(`Stopped  ${stopped.id}  ${enriched.description}`)
  writeOut(`Elapsed  ${formatDuration(enriched.durationSeconds)}`)
  writeOut(`Project  ${enriched.projectName ?? '(no project)'}`)
  if (noteRecorded) writeOut('Note     saved')
  return 0
}

export async function runCurrent(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const ctx = await createLeanContext(args)

  const running = await currentEntry(ctx.client)
  await mirrorFrom(running)

  if (!running) {
    if (json) writeJson(successEnvelope('current', null, { apiCalls: ctx.apiCalls() }))
    else writeOut('No timer is running.')
    return 0
  }

  const enriched = enrich(ctx, running)
  if (json) {
    writeJson(successEnvelope('current', enriched, { apiCalls: ctx.apiCalls() }))
    return 0
  }

  writeOut(`Running  ${running.id}  ${enriched.description}`)
  writeOut(`Project  ${enriched.projectName ?? '(no project)'}`)
  writeOut(`Elapsed  ${formatDuration(enriched.durationSeconds)}  since ${enriched.startLocal.slice(11, 16)}`)
  return 0
}

export async function runCancel(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, TIMER_OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const ctx = await createLeanContext(args)

  const mirror = await readRunningMirror()
  let target: WireTimeEntry | null = null

  if (mirror?.state === 'running' && mirror.entryId && mirror.workspaceId) {
    target = {
      id: mirror.entryId,
      at: mirror.writtenAt,
      description: mirror.description ?? '',
      start: mirror.start ?? mirror.writtenAt,
      stop: null,
      duration: -1,
      billable: false,
      project_id: mirror.projectId ?? null,
      task_id: null,
      tags: mirror.tags ?? [],
      tag_ids: [],
      user_id: 0,
      workspace_id: mirror.workspaceId,
    }
  } else {
    target = await currentEntry(ctx.client)
  }

  if (!target) {
    if (json) writeJson(successEnvelope('cancel', { cancelled: false, reason: 'no-running-entry' }))
    else writeOut('No timer is running.')
    return 0
  }

  if (!readBoolean(args, 'yes')) {
    if (json || !process.stdin.isTTY) {
      throw new UsageError('Cancelling discards the entry. Pass --yes to confirm.')
    }
    const confirmed = await promptConfirm(`Discard ${target.id} "${target.description ?? ''}"?`)
    if (!confirmed) {
      writeOut('Cancelled nothing.')
      return 0
    }
  }

  await deleteEntry(ctx.client, target.workspace_id, target.id)
  await mirrorFrom(null)
  await recordNote(ctx, target, { body: 'Entry discarded before it was registered.' }, 'cancel')

  if (json) writeJson(successEnvelope('cancel', { cancelled: true, entryId: target.id }))
  else writeOut(`Deleted ${target.id}. The note is kept, marked cancelled.`)
  return 0
}
