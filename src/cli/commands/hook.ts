import { readConfig } from '../../state/config.ts'
import { openDatabase } from '../../db/open.ts'
import { databasePath } from '../../db/paths.ts'
import { resolveTimezone } from '../../db/settings.ts'
import { listRunning, listRunningDrafts } from '../../db/entries.ts'
import { runTouched } from '../hooks/touched.ts'
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

async function runPromptSubmit(): Promise<number> {
  const db = openDatabase(databasePath())
  try {
    const now = new Date()
    const timezone = resolveTimezone(db)
    const drafts = listRunningDrafts(db).map((row) => enrichEntry(row, timezone, now))
    if (drafts.length === 0) return 0

    const lines = drafts.map(
      (draft) =>
        `  #${draft.id} lleva ${draft.durationHuman}${draft.projectName ? ` en ${draft.projectName}` : ' y aun sin proyecto'}`,
    )

    const additionalContext = [
      'Registro de tiempo (bita): hay un cronometro corriendo SIN TITULO.',
      ...lines,
      '',
      'Si el mensaje del usuario dice en que se va a trabajar, rellenalo AHORA,',
      'antes de ponerte a explorar o a planear:',
      '  bita amend --draft --title "<titulo corto>" --project <nombre o id>',
      '',
      'El titulo es la clave de agrupacion y el summary del issue de Jira: corto y',
      'reconocible. Un repo NO es un proyecto: los proyectos son grupos con varios',
      'repos dentro, asi que resuelve el proyecto por el grupo, no por el repo.',
      'Si el mensaje todavia no dice en que se trabaja, no inventes nada y sigue.',
    ].join('\n')

    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
      })}\n`,
    )
  } finally {
    db.close()
  }
  return 0
}

export async function runHook(argv: string[]): Promise<number> {
  const event = argv[0] ?? 'session-start'

  if (event === 'prompt-submit') {
    try {
      return await runPromptSubmit()
    } catch {
      return 0
    }
  }

  if (event === 'touched') {
    try {
      const flagIndex = argv.indexOf('--file')
      const file = flagIndex === -1 ? undefined : argv[flagIndex + 1]
      if (file) await runTouched(file)
    } catch {
      return 0
    }
    return 0
  }

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
