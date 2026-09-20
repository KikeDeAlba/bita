import { readConfig } from '../../state/config.ts'
import { openDatabase } from '../../db/open.ts'
import { databasePath } from '../../db/paths.ts'
import { resolveTimezone } from '../../db/settings.ts'
import { listRunning } from '../../db/entries.ts'
import { enrichEntry } from '../../domain/enrich.ts'
import { currentRepoIdentity } from './repo.ts'
import { resolveMappedProject } from '../resolve-project.ts'

const RULE = [
  'Registro de tiempo (bita): este repositorio esta mapeado a un proyecto.',
  'Si el trabajo que empieza va a dejar un artefacto (un commit, un archivo, un recurso desplegado,',
  'una migracion, una MR, una causa raiz diagnosticada) propone arrancar el cronometro en una linea,',
  'justo antes de la primera edicion, y arrancalo solo con un si explicito:',
  '  bita start "<titulo corto>"',
  'No lo propongas para preguntas, lecturas, busquedas ni arreglos de una linea.',
  'Pueden correr varios cronometros a la vez: si empiezas algo distinto, arranca otro en vez de',
  'parar el que hay. Al terminar, escribe la nota rica (resumen y lo que se toco) y para:',
  '  bita stop <id> --note-json <archivo>',
].join('\n')

export async function runHook(argv: string[]): Promise<number> {
  const event = argv[0] ?? 'session-start'
  if (event !== 'session-start') return 0

  try {
    const identity = await currentRepoIdentity()
    if (!identity) return 0

    const config = await readConfig()
    const mapping = resolveMappedProject(identity.slug, config)
    if (!mapping) return 0

    const db = openDatabase(databasePath())
    let state: string
    try {
      const now = new Date()
      const timezone = resolveTimezone(db)
      const running = listRunning(db).map((row) => enrichEntry(row, timezone, now))
      state =
        running.length === 0
          ? 'No hay ningun cronometro corriendo.'
          : [
              `Cronometros CORRIENDO (${running.length}):`,
              ...running.map(
                (entry) =>
                  `  #${entry.id} "${entry.description}" (${entry.durationHuman}${entry.projectName ? `, ${entry.projectName}` : ''})`,
              ),
            ].join('\n')
    } finally {
      db.close()
    }

    const additionalContext = [
      RULE,
      '',
      `Proyecto de este repositorio: ${mapping.projectName}.`,
      state,
    ].join('\n')

    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
      })}\n`,
    )
  } catch {
    return 0
  }

  return 0
}
