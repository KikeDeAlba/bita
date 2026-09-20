# bita

Registro de tiempo local, en SQLite, pensado para que Claude Code lo lea y lo
escriba. Mide el trabajo mientras ocurre y después lo vuelca a Jira: un issue por
título y proyecto, un worklog por cada bloque medido, con estimación y cierre.

El nombre viene de bitácora.

## Por qué existe

Antes esto hablaba con la API de Toggl Track. El plan gratuito tiene un límite
horario de llamadas que bloqueó el trabajo tres veces en una sola sesión, dos de
ellas a mitad de una escritura, dejando Jira por delante del registro de tiempo.

Casi toda la complejidad del CLI servía para rodear ese límite, no para resolver
el problema: el throttle, los reintentos, la paginación, el caché de 24 horas, el
espejo del cronómetro en curso y los tags usados como estado porque no había
dónde guardarlo. Con una base local todo eso desaparece.

Quedan dos ventajas que no se buscaban:

- **Varios cronómetros a la vez.** El límite de uno era de Toggl. Aquí un
  cronómetro corriendo es una fila con `stopped_at` nulo, y puede haber las que
  hagan falta.
- **El estado es una clave foránea.** Una entrada está pendiente mientras no
  tenga fila en `jira_links`. No hay tag que pueda diverger ni retaggeo a medias.

## Requisitos

Node 24 o superior, por `node:sqlite` y por el borrado de tipos nativo. No hay
dependencias de runtime ni paso de compilación.

## Instalación

```sh
pnpm install
pnpm link --global
```

La base vive en `~/.local/share/bita/bita.db`. Se crea sola al primer uso, y
`BITA_DB_PATH` la mueve a otro sitio.

## Uso

```sh
bita start "Despliegue de infraestructura"   # arranca; puede haber varios
bita ls                                      # qué está corriendo ahora
bita stop 12 --note-json /tmp/nota.json      # para uno y le adjunta la nota
bita log "Sesión con QA" --from 14:00 --for 1h
bita summary --pending --json                # agrupado y listo para Jira
bita link 12 13 --issue DD-1896              # marca como registradas
```

`bita --help` lista todo.

### Formato de salida

Todos los comandos aceptan `--json` y emiten un solo documento en stdout:

```json
{ "schemaVersion": 3, "ok": true, "command": "summary", "data": {}, "meta": {} }
```

Los errores salen con `ok: false` y un `error.code` estable. Los avisos van a
stderr, nunca a stdout, para que el JSON se pueda parsear tal cual.

## Cómo se agrupa

Un grupo es **proyecto + título**, a lo largo de todo el rango, y se convierte en
un issue de Jira. Cada entrada del grupo es un worklog con su hora real.

La estimación original se redondea **hacia arriba** al siguiente medio punto: 3h
43m medidas se registran como 4h de estimación con worklogs que suman 3h 43m. Un
issue admite como máximo 8 horas; lo que se pasa se parte en `(1/n)`, `(2/n)`.

## Solapes

Los cronómetros simultáneos están permitidos, así que un día puede sumar más
tiempo del que marca el reloj. `summary` y `entries` lo avisan:

```
Warning: 2026-09-19: 4h 8m tracked over 3h 7m of clock time (1h overlapping)
```

No lo impide. Solo evita que pase inadvertido.

## La skill

`skill/SKILL.md` es la skill de Claude Code que envuelve el CLI: decide cuándo
proponer el cronómetro, infiere la Historia de Jira a partir de las notas, y
maneja la jerarquía Épica → Historia → Subtarea. Está enlazada por symlink desde
`~/.claude/skills/bita`, para que el procedimiento y los flags cambien en el
mismo commit.

## Desarrollo

```sh
pnpm typecheck
pnpm test
```

Los tests corren con `node --test` sobre los `.ts` directamente. No hay bundler.

## Estructura

```
src/db/        el almacén: esquema, migraciones y consultas
src/domain/    lógica pura: agrupación, duraciones, zonas horarias, solapes
src/cli/       comandos y formato de salida
src/state/     configuración y notas en disco
skill/         la skill de Claude Code
```

El punto de corte es `EnrichedTimeEntry` (`src/domain/types.ts`): todo lo que
está aguas abajo no sabe de dónde salieron los datos.
