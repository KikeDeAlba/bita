---
name: toggl-jira
description: >-
  Lee los registros de tiempo de Toggl Track con el CLI local `toggl`, los agrupa
  por título y proyecto, y los pasa a Jira creando la tarea, poniendo la
  estimación original, registrando un worklog por cada bloque real de tiempo,
  cerrando la tarea y marcando la entrada como registrada en Toggl. Úsala cuando
  el usuario quiera ver, revisar o reportar en qué trabajó según Toggl, o cuando
  quiera volcar ese tiempo a Jira. Frases que la disparan: "registra mis horas de
  esta semana en Jira", "pasa mi tiempo de Toggl a Jira", "qué hice según Toggl",
  "qué trabajé esta semana", "sube las horas de ayer", "reporta mi tiempo del
  mes", "cuántas horas llevo hoy", "registra lo que tengo pendiente en Toggl". No
  la uses para arrancar o parar un cronómetro en Toggl, ni para tareas de Jira que
  no vengan de un registro de tiempo.
---

# toggl-jira

Toggl Track es la fuente de la verdad. Nada de estimar desde commits: las horas
son las medidas.

## Convención del usuario

Cada registro de Toggl lleva **título, proyecto y un tag de estado**:

- `Pending` — todavía no está en Jira.
- `Registered` — ya está en Jira.

Los tags llevan mayúscula inicial en el workspace. El filtrado no distingue
mayúsculas, y al escribir el CLI reusa la grafía exacta que ya existe, así que
puedes pasar `--pending` o `--add registered` sin preocuparte: no se crea un tag
duplicado.

El filtro de entrada es el **tag**, no la fecha. El rango es un acotador opcional.

## Reglas duras

1. **No emitas ninguna llamada de escritura antes de una confirmación explícita.**
   Una respuesta ambigua se trata como "ajustar", nunca como "sí".
2. **Resuelve todos los mapeos de proyecto antes de escribir nada.** Si a mitad
   del flujo falta uno, ya habría issues creados y la interrupción dejaría el
   trabajo a medias.
3. **El retaggeo en Toggl es lo último de cada grupo.** Es el punto de commit:
   mientras el tag no cambie, el trabajo se considera no hecho. Perder horas es
   peor que duplicarlas, y esto es lo que evita perderlas.
4. **Nunca uses `curl` contra Toggl.** El token acabaría en el transcript y en el
   historial del shell. Todo pasa por el CLI.
5. **No encadenes comandos** con `|`, `;` ni `&&`, y no invoques el CLI con
   `pnpm run`: su banner rompería el parseo del JSON.
6. **No calcules fechas ni duraciones.** El CLI ya entrega `startedJira`,
   `timeSpent` y `totalHuman` listos. Cópialos literalmente.

## La cuota horaria de Toggl

El plan gratuito tiene un **límite horario de llamadas**, aparte del leaky bucket.
Devuelve **402** y el CLI sale con **exit 8** diciendo cuántos minutos faltan.
Reintentar no sirve.

Es seguro por construcción: salta antes de escribir nada. Pero **comprueba que hay
margen antes de empezar una corrida de escritura**: si la cuota se acaba entre los
worklogs de Jira y el retaggeo, las entradas se quedan en `Pending` con sus horas
ya en Jira, y la siguiente corrida duplicaría los worklogs. Si eso pasa a mitad de
camino, **para el lote** y espera.

Cada comando gasta llamadas, así que `/me` y el catálogo están cacheados 24h y
`map list` funciona sin red. `--offline` trabaja solo con la caché.

## Procedimiento

### 0. Verificar

```
toggl whoami --json
```

Si el CLI no responde, detente y dile cómo instalarlo. Confirma también con qué
cuenta de Atlassian se van a registrar las horas (`atlassianUserInfo`): el
conector escribe con esa identidad y reasignar un worklog después es incómodo.

### 1. Resolver el alcance

- Sin rango: todas las `pending`, con tope de 90 días hacia atrás. El CLI lo
  avisa; repítelo al usuario.
- Con rango: pásalo como preset (`today`, `yesterday`, `week`, `last-week`,
  `month`, `last-month`) o como `--from`/`--to`. **El cálculo lo hace el CLI.**
- Confirma el alcance en una línea antes de seguir.

### 2. Leer y agrupar

```
toggl summary --pending --json
```

Devuelve un envelope con `data.groups`. Cada grupo es **una tarea de Jira**:

- `summary` — el título tal cual lo escribió el usuario en Toggl.
- `totalSeconds` / `totalHuman` — el tiempo real medido, que es lo que suman los worklogs.
- `estimateSeconds` / `estimateHuman` — **la estimación original**, redondeada hacia
  arriba al siguiente medio punto. Es este el que va a `timetracking`, no el total:
  3h 43m medidas se registran como 4h de estimación con worklogs que suman 3h 43m.
- `worklogs[]` — **un worklog por cada bloque de tiempo**, con su `startedJira`
  y su `timeSpent` ya formateados.
- `entryIds[]` — las entradas de Toggl que hay que retaggear al terminar.
- `jiraProjectKey` — `null` si el proyecto aún no está mapeado.
- `partIndex` / `partCount` / `splitReason` — ver el tope de 8 horas.

En `meta` vienen `excluded`, `alreadyRegistered`, `unmappedProjects` y `warnings`.

### 3. Triaje

Reporta los cubos aunque no se procesen. Ninguno se escribe en Jira:

| Motivo | Qué hacer |
|---|---|
| `both-tags` | **Nunca escribir.** Es la firma de un retaggeo a medias: Jira probablemente ya tiene el worklog. Ofrece quitar solo `pending`. |
| `running` | Excluir. "Tienes un cronómetro corriendo; páralo y vuelve a ejecutar." |
| `no-description` | No inventes título. Lista y pide uno, o déjalas pendientes. |
| `zero-duration` | Excluir: Jira rechaza worklogs de menos de un minuto. |
| `alreadyRegistered` | Solo se cuenta para el reporte. |

### 4. Tope de 8 horas por tarea

Una tarea admite como máximo **8 horas** de worklog y 8 de estimación original.
El CLI ya parte lo que se pasa y numera las partes `(1/n)`, `(2/n)`. Cuando veas
`splitReason: "max-task-hours"`, dilo en la propuesta: son varias tareas de Jira
para un mismo título. Con `--max-task-hours N` se cambia el tope.

### 5. Resolver los mapeos faltantes, en un solo bloque

Para cada proyecto en `meta.unmappedProjects`, pregunta a qué tablero de Jira va.
**No listes todos los proyectos**: pide la clave (`DPF`, `INN`) y valídala con
`getVisibleJiraProjects(searchString)`. Si lo que escribe no parece una clave,
trátalo como búsqueda y muestra un máximo de 8 candidatos numerados.

Persiste cada respuesta en cuanto se confirme:

```
toggl map set <togglProjectId> <JIRAKEY> --issue-type "Tarea"
toggl map set <togglProjectId> <JIRAKEY> --parent <JIRAKEY-123> --issue-type "Tarea"
```

**Varios proyectos de Toggl pueden compartir tablero y diferir solo en el padre.**
Ese es el caso normal, no la excepción: el mapeo guarda `jiraProjectKey` y
`parentKey` por separado, y el CLI valida que el padre pertenezca al tablero.

**El padre no siempre es una épica.** Antes de mapearlo, léelo con `getJiraIssue`
y mira su `issuetype.hierarchyLevel`:

- Nivel 1 (**Epic**) → el hijo puede ser una `Tarea` normal con `parent`.
- Nivel 0 (**Historia**, **Tarea**) → está al mismo nivel que una Tarea, así que el
  hijo **tiene que ser una `Subtarea`**. Si el usuario te da una Historia como
  destino, pregúntale si quiere subtareas colgando de ella o los worklogs
  directamente sobre la Historia, que muchas veces es lo que quiere decir una
  historia tipo «Sesiones de septiembre».

Los proyectos ya mapeados se resuelven en silencio: **no vuelvas a preguntar por
ellos nunca**. Si el usuario cancela a mitad del bloque, aborta la corrida entera.

Entradas **sin proyecto** en Toggl: no les inventes destino. Lístalas aparte y
ofrece asignarles uno solo para esta corrida, o dejarlas pendientes.

### 6. Preflight por proyecto

Una vez por combinación de proyecto y tipo de issue:

- `getJiraProjectIssueTypesMetadata` → el id del tipo. **Los tipos están en
  español**: "Tarea", "Historia", "Error", "Subtarea", "Epic". Nunca asumas "Task".
- `getJiraIssueTypeMetaWithFields` → si `timetracking` está en la pantalla, y qué
  campos son obligatorios.

Si el proyecto no expone `timetracking`, **registra el worklog igual** y salta la
estimación. Avísalo una vez por proyecto, no una por issue.

### 7. Propuesta y confirmación

Tabla con una fila por tarea: proyecto Toggl → Jira, tipo, resumen, número de
worklogs, rango de fechas y total. Debajo, lo excluido con su motivo. Pregunta
además, una sola vez, **si hay que cerrar las tareas al terminar**.

Menú de cuatro opciones:

1. Confirmar y escribir.
2. Ajustar: fusionar, partir, renombrar, cambiar proyecto o excluir grupos.
3. Ver el detalle de un grupo: el payload literal que se enviaría.
4. Cancelar.

Si la frase del usuario fue de consulta ("qué trabajé esta semana"), **termina
aquí**: eso es el reporte, no hay escritura.

### 8. Grupo canario

**La primera vez que una corrida toque Jira, procesa un solo grupo completo**,
enseña el enlace y **para a confirmar otra vez** antes de seguir. Acota el daño de
un error sistémico (time tracking deshabilitado, transición equivocada, permisos)
a un issue en vez de a veinte. Sáltalo solo si el usuario lo pide explícitamente,
y nunca en la primera corrida histórica.

### 9. Escribir, grupo por grupo

En este orden, sin paralelismo:

1. `createJiraIssue` — `summary` **literal** del grupo, sin reescribir: es la
   clave de agrupación y lo que el usuario reconocerá al buscar. La
   `description` se construye con la tabla de bloques y los ids de Toggl.
   `issueTypeName` va por nombre (`"Tarea"`, `"Subtarea"`), no por id, y `parent`
   lleva la clave del padre cuando el mapeo tiene `parentKey`.
2. `editJiraIssue` con `timetracking.originalEstimate` = **`estimateHuman`** del grupo y
   `remainingEstimate: "0m"`. **Antes del worklog**, porque algunos workflows
   bloquean la edición de campos una vez cerrado el issue, y porque el tool de
   worklog no expone `adjustEstimate`: fijar el cero explícitamente es correcto
   tanto si Jira decrementa solo como si no.
3. `addWorklogToJiraIssue` **una vez por cada entrada de `worklogs[]`**, copiando
   `startedJira` y `timeSpent`. En `commentBody`, el rastro de auditoría:
   `Toggl · <startLocal> · toggl:<entryId>`.
4. Si toca cerrar: `getTransitionsForJiraIssue` y elige **por lo que devuelva**,
   nunca por nombre a ciegas. Ver abajo.
5. `toggl tag --ids <entryIds> --add registered --remove pending --apply --yes`,
   en una sola llamada por grupo.

### Elegir la transición de cierre

1. Filtra las transiciones cuyo `to.statusCategory.key === "done"`.
2. Si queda **una**, úsala.
3. Si quedan **varias**, elige por el **nombre del estado destino (`to.name`)**,
   nunca por el nombre de la transición. No son lo mismo y confundirlos cancela
   trabajo: en **VBGLOBAL la transición se llama «Listo» pero su `to.name` es
   «Cancelado»**, y la de cierre real es «Closed» → «Cerrada».

   - Orden de preferencia sobre `to.name`: Finalizada, Finalizado, Cerrada,
     Cerrado, Hecho, Completada, Terminado, Done.
   - **Descarta siempre** los `to.name` que suenen a abandono o a paso
     intermedio: Cancelado, Cancelada, Duplicado, No se hará, Rechazado,
     READY TO TEST, Ready to test.
   - Si tras eso sigue habiendo varias, **pregunta**. Propónla en la
     confirmación la primera vez y guárdala en el mapeo.
4. Si **ninguna** está en categoría `done`, da **un solo salto** hacia una
   `indeterminate` y vuelve a consultar. Máximo dos saltos. Nunca iteres
   transiciones a ver cuál pega: cada intento dispara notificaciones y
   automatizaciones.
5. Si la transición **pide campos obligatorios**: rellena `resolution` solo si hay
   un único candidato evidente. En cualquier otro caso deja el issue abierto y
   repórtalo. Una resolución mal puesta contamina las métricas del equipo.

## Manejo de fallos

| Falla en | Qué queda | Qué hacer |
|---|---|---|
| `createJiraIssue` | Nada escrito, entradas `pending` | Reintentar es seguro |
| `timetracking` | Issue sin estimación | Continuar sin ella y avisar |
| worklog **parcial** | Issue con worklogs incompletos | Retaggear **solo** las entradas que sí quedaron, anotar la key, reanudar sobre ese issue |
| transición | Issue correcto, abierto | **Retaggear igual**: el tiempo ya está registrado, y dejarlo `pending` duplicaría worklogs |
| `toggl tag` | Jira sí, Toggl no | **Detén la corrida entera.** Ver abajo |
| cuota agotada (exit 8) | Depende de dónde saltó | Si fue antes de escribir, no pasa nada. Si fue en el retaggeo, es el caso de la fila anterior |

**Exit 7 de `toggl tag` es "detente y avisa", nunca "reintenta el flujo".** El CLI
imprime los ids inconsistentes y el comando exacto de reparación: muéstraselo
literal y adviértele de no volver a correr la skill sobre ese rango hasta
arreglarlo. Los worklogs de Jira **no se pueden borrar** con el conector, así que
un duplicado se limpia a mano en la UI.

Antes de crear un issue, un `searchJiraIssuesUsingJql` de aviso
(`project = X AND summary ~ "..." AND reporter = currentUser() AND created >= -30d`)
detecta posibles duplicados. **Avisa, no decide**: es una búsqueda difusa.

## Resumen final

Una fila por tarea con cinco marcas — crear, estimar, worklog, cerrar, retaggear —
el enlace al issue y el total. Cualquier inconsistencia va **arriba**, no al final.

## Reglas de agrupación

Esta sección es editable a mano; es la palanca principal para ajustar el
comportamiento.

- Clave de agrupación: **proyecto de Toggl + título**, a lo largo de todo el rango.
  Un grupo puede cruzar días y no se parte por eso.
- El título se compara sin espacios de más y sin puntuación final; por defecto **se
  distinguen mayúsculas** (`--case-insensitive` las une).
- El CLI **no fusiona por similitud**. "Refactor pagos" y "refactor de pagos" son
  dos tareas. Si ves títulos casi iguales, sugiere la fusión en la propuesta y
  deja que decida el usuario.
- Cuidado con títulos genéricos ("daily", "junta", "soporte"): pueden colapsar
  semanas en un issue gigante. El rango de fechas por grupo lo hace visible en la
  propuesta.
