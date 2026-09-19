import { readConfig } from '../../state/config.ts'
import { isMirrorFresh, readRunningMirror } from '../../state/running.ts'
import { formatDuration } from '../../domain/duration.ts'
import { currentRepoIdentity } from './repo.ts'

const RULE = [
  'Registro de tiempo (toggl-track-cli): este repositorio esta mapeado a un proyecto de Toggl.',
  'Si el trabajo que empieza va a dejar un artefacto (un commit, un archivo, un recurso desplegado,',
  'una migracion, una MR, una causa raiz diagnosticada) propone arrancar el cronometro en una linea,',
  'justo antes de la primera edicion, y arrancalo solo con un si explicito:',
  '  toggl start "<titulo corto>"',
  'No lo propongas para preguntas, lecturas, busquedas ni arreglos de una linea.',
  'Al terminar, escribe la nota rica (resumen y lo que se toco) y para:',
  '  toggl stop --note-json <archivo>',
].join('\n')

function runningLine(description: string, startIso: string, now: Date): string {
  const started = Date.parse(startIso)
  const elapsed = Number.isFinite(started)
    ? formatDuration(Math.max(0, Math.floor((now.getTime() - started) / 1000)))
    : 'unknown'
  return `Hay un cronometro CORRIENDO: "${description}" (${elapsed}). No arranques otro; paralo o usa --switch.`
}

export async function runHook(argv: string[]): Promise<number> {
  const event = argv[0] ?? 'session-start'
  if (event !== 'session-start') return 0

  try {
    const identity = await currentRepoIdentity()
    if (!identity) return 0

    const config = await readConfig()
    const mapping = config.repoMapping[identity.slug]
    if (!mapping) return 0

    const now = new Date()
    const mirror = await readRunningMirror()
    const state =
      mirror?.state === 'running' && isMirrorFresh(mirror, now)
        ? runningLine(mirror.description ?? '', mirror.start ?? '', now)
        : 'No hay ningun cronometro corriendo.'

    const additionalContext = [
      RULE,
      '',
      `Proyecto de Toggl de este repositorio: ${mapping.togglProjectName}.`,
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
