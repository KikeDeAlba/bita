import { readFile } from 'node:fs/promises'
import { UsageError } from '../../errors.ts'
import { BASE_OPTIONS, parseCommandArgs, readBoolean, readString } from '../args.ts'
import { appendNote, parseNoteInput, readNotesByEntryId } from '../../state/notes.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'
import { readConfig } from '../../state/config.ts'

export async function runNote(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'get'
  const args = parseCommandArgs(argv.slice(1), { 'note-json': { type: 'string' } }, BASE_OPTIONS)
  const json = readBoolean(args, 'json')

  const [rawId] = args.positionals
  if (!rawId) throw new UsageError(`Usage: toggl note ${subcommand} <entryId>`)
  const entryId = Number(rawId)
  if (!Number.isInteger(entryId)) throw new UsageError(`Invalid entry id: "${rawId}".`)

  if (subcommand === 'get') {
    const notes = await readNotesByEntryId([entryId])
    const note = notes.get(entryId) ?? null

    if (json) {
      writeJson(successEnvelope('note get', note))
      return 0
    }
    if (!note) {
      writeOut(`No note recorded for entry ${entryId}.`)
      return 0
    }
    writeOut(note.body)
    if (note.artifacts.files.length > 0) writeOut(`\nFiles: ${note.artifacts.files.join(', ')}`)
    if (note.artifacts.commands.length > 0) writeOut(`Commands: ${note.artifacts.commands.join(', ')}`)
    return 0
  }

  if (subcommand === 'set') {
    const notePath = readString(args, 'note-json')
    if (!notePath) throw new UsageError('Usage: toggl note set <entryId> --note-json <file>')

    let raw: unknown
    try {
      raw = JSON.parse(await readFile(notePath, 'utf8'))
    } catch (error) {
      throw new UsageError(`Could not read the note at ${notePath}: ${String(error)}`)
    }

    const config = await readConfig()
    const note = parseNoteInput(raw, {
      entryId,
      workspaceId: config.workspaceId ?? 0,
      source: 'manual',
      title: '',
      recordedAt: new Date().toISOString(),
    })
    await appendNote(note)

    if (json) writeJson(successEnvelope('note set', { entryId, recorded: true }))
    else writeOut(`Note recorded for entry ${entryId}.`)
    return 0
  }

  throw new UsageError(`Unknown note subcommand "${subcommand}". Use get or set.`)
}
