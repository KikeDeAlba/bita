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

**Node 24 o superior.** No es negociable: bita usa `node:sqlite` y el borrado de
tipos nativo, así que corre los `.ts` sin compilar. No hay dependencias de
runtime, ni bundler, ni paso de build.

```sh
node -v    # debe decir v24 o más
```

## Instalación

### 1. Clonar e instalar

```sh
git clone git@github.com:KikeDeAlba/bita.git
cd bita
pnpm install
```

Las únicas dependencias son TypeScript y `@types/node`, y solo para el
`typecheck`.

### 2. Correr el instalador

```sh
./scripts/install.sh
```

Hace cuatro cosas, y todas son idempotentes: puedes volver a correrlo cuando
quieras.

| Paso | Qué hace |
|---|---|
| Binario | Enlaza `bita` en tu directorio de binarios (`$PNPM_HOME/bin`, o `~/.local/bin`) |
| Skill | `~/.claude/skills/bita` → `skill/` del repo |
| Comandos | `~/.claude/commands/bita-*.md` → `commands/` del repo |
| Settings | Añade los permisos y el hook `SessionStart` a `~/.claude/settings.json` |

Todo son **symlinks al repo**, a propósito: cuando actualizas el repo, la skill y
los comandos se actualizan contigo, y un cambio de flag en el CLI viaja en el
mismo commit que su documentación.

Antes de tocar `settings.json` deja una copia en `settings.json.backup`, y si no
lo puede parsear no lo escribe: imprime el bloque para que lo pegues a mano.

Si tu directorio de binarios está en otro sitio:

```sh
BITA_BIN_DIR=~/bin ./scripts/install.sh
```

### 3. Comprobar

```sh
bita --version
bita projects
```

La base se crea sola en `~/.local/share/bita/bita.db` al primer uso. `BITA_DB_PATH`
la mueve a otro sitio, que es también la forma de probar cosas sin tocar la real.

### 4. Crear un proyecto y mapear el repositorio

Esto es lo que enciende la integración con Claude:

```sh
bita project add "Mi proyecto"     # devuelve un id
cd ~/ruta/al/repositorio
bita repo set . <projectId>
```

**Mientras un repositorio no esté mapeado, el hook no dice nada.** En cuanto lo
está, al abrir una sesión de Claude Code en él se inyecta la regla que le pide
ofrecer el cronómetro cuando el trabajo vaya a dejar un artefacto —un commit, un
archivo, un despliegue— y callarse cuando solo vayas a leer o preguntar.

El mapeo se guarda por el **slug** del repositorio, que sale del remoto de git
(`github.com/kikedealba/bita`), así que sobrevive a que muevas la carpeta.

Reabre la sesión de Claude Code para que cargue el hook, la skill y los comandos.

### 5. Conectar Jira

Jira no se toca desde el CLI: lo escribe Claude por el conector de Atlassian. Lo
único que se guarda aquí es a qué tablero va cada proyecto, y se pregunta solo la
primera vez:

```sh
bita map set <projectId> <JIRAKEY> --parent <JIRAKEY-123>
bita map list
```

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

## Los comandos de Claude Code

`commands/` tiene cuatro slash commands, enlazados por symlink desde
`~/.claude/commands/`:

| Comando | Qué hace |
|---|---|
| `/bita-start [título]` | Arranca un cronómetro. Sin título, lo infiere de la sesión y lo enseña antes |
| `/bita-stop [id]` | Escribe la nota de lo que se hizo y para. Con varios abiertos, pregunta cuál |
| `/bita-timers` | Qué está corriendo y cuánto llevas hoy |
| `/bita-log <texto>` | Registra un bloque que ya pasó, cuando se trabajó sin cronómetro |

Viven en el repo por la misma razón que la skill: usan los flags del CLI, así que
cambian en el mismo commit.

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
