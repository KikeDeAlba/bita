import { UsageError } from '../../errors.ts'
import { BASE_OPTIONS, parseCommandArgs, readBoolean, readInteger } from '../args.ts'
import { createLocalContext } from '../local-context.ts'
import { successEnvelope, writeErr, writeJson, writeOut } from '../output.ts'
import { renderTable } from '../table.ts'
import { migrateNotes } from '../../docs/migrate.ts'
import { NOTES_PATH } from '../../state/notes.ts'

const OPTIONS = {
  'dry-run': { type: 'boolean' as const, default: false },
  limit: { type: 'string' as const },
}

export async function runNotes(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'migrate'
  if (subcommand !== 'migrate') {
    throw new UsageError(`Unknown notes subcommand "${subcommand}". Use migrate.`)
  }

  const args = parseCommandArgs(argv.slice(1), OPTIONS, BASE_OPTIONS)
  const json = readBoolean(args, 'json')
  const dryRun = readBoolean(args, 'dry-run')
  const limit = readInteger(args, 'limit')
  const ctx = createLocalContext(args)

  try {
    const report = await migrateNotes(ctx, {
      dryRun,
      ...(limit === undefined ? {} : { limit }),
    })

    if (json) {
      writeJson(
        successEnvelope('notes migrate', report, { root: ctx.docsRoot, legacyPath: NOTES_PATH }),
      )
      return 0
    }

    if (report.entries === 0) {
      writeOut(`Nothing to migrate: no notes in ${NOTES_PATH}.`)
      return 0
    }

    writeOut(
      renderTable(
        [{ header: 'ENTRY', align: 'right' }, { header: 'NOTES', align: 'right' }, { header: 'ACTION' }, { header: 'DOCUMENT' }],
        report.items.map((item) => [
          String(item.entryId),
          String(item.notes),
          item.action,
          item.relPath ?? '',
        ]),
      ),
    )
    writeOut('')
    writeOut(
      `${report.scanned} notes over ${report.entries} entries: ` +
        `${report.created} created, ${report.updated} updated, ${report.skipped} already current.`,
    )
    if (report.orphans.length > 0) {
      writeOut(`${report.orphans.length} notes belong to entries that no longer exist and were left alone.`)
    }
    writeOut(dryRun ? 'Nothing was written.' : `Documents under ${ctx.docsRoot}`)
    writeErr(`The notes file stays where it is, read-only from now on: ${NOTES_PATH}`)
    return 0
  } finally {
    ctx.db.close()
  }
}
