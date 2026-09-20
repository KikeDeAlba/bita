---
name: bita
description: >-
  Lleva el tiempo de trabajo registrado en bita a Jira, y maneja el cronómetro en
  vivo. Arranca y para el cronómetro cuando empieza y termina un trabajo,
  escribiendo una descripción real de lo que se hizo; y después agrupa las
  entradas y crea los issues de Jira con su jerarquía (Épica → Historia →
  Subtarea), su estimación, un worklog por cada bloque medido, y el cierre.
  Úsala cuando el usuario quiera arrancar o parar el conteo de tiempo, saber
  cuánto lleva, ver o reportar en qué trabajó, o volcar ese tiempo a Jira.
  Frases que la disparan: "arranca el tiempo", "para el cronómetro", "cuánto
  llevo", "registra mis horas de esta semana en Jira", "pasa mi tiempo a Jira",
  "qué trabajé esta semana", "sube las horas de ayer", "reporta mi tiempo del
  mes", "registra lo que tengo pendiente". No la uses para tareas de Jira que no
  vengan de un registro de tiempo.
---

# bita

El registro local de bita es la fuente de la verdad. Nada de estimar desde
commits: las horas son las medidas.

## El contador arranca antes de saber nada

El flujo normal es: abrir Claude sobre `~/dev`, **arrancar el contador en blanco**
con `/bita-start`, y solo entonces escribir el encargo. Planear es trabajo y el
reloj ya está corriendo mientras se planea.

Eso significa que **el contador nace sin título y sin proyecto**, y que rellenarlo
es tarea tuya:

1. El hook `prompt-submit` te avisa en cada turno mientras siga sin título.
2. **En cuanto un mensaje diga en qué se va a trabajar, rellénalo — antes de
   explorar y antes de planear.** No esperes al final.

   ```
   bita amend --draft --title "<titulo corto>" --project <nombre o id>
   ```
3. Al terminar el plan, enriquece la descripción con lo que concluyó:
   `bita amend --draft --note-json <archivo>`.

El título es la clave de agrupación y el summary del issue, así que corto y
reconocible. Un borrador sin título queda fuera de `summary`, o sea que si no lo
rellenas, esas horas no llegan a Jira.

## Un repo no es un proyecto

Los proyectos son **grupos con varios repos dentro**, y el grupo no tiene `.git`:
lo tienen los repos.

```
gitlab.com/vivaaerobus/vb_solemti/apartados/api      ─┐
gitlab.com/vivaaerobus/vb_solemti/apartados/front    ─┤  todos son "Apartados"
gitlab.com/vivaaerobus/vb_solemti/apartados/workers  ─┘
```

El mapeo va por **prefijo de ruta**, y gana el más largo que empate. `bita repo
show` dice qué prefijo empató, que es como se depura esto. `bita scope list` los
lista todos.

Si no hay prefijo, se propone por nombre de segmento. **Enseña siempre el prefijo
que se va a guardar antes de confirmarlo**: empatar un segmento ancho como
`vivaaerobus` guardaría un prefijo que se traga toda la organización.

## Convención del usuario

Cada entrada lleva **título y proyecto**. El estado no es una etiqueta: una
entrada está **pendiente mientras no tenga fila en `jira_links`**, y pasa a
registrada cuando `bita link` la ata a un issue. Es una clave foránea, así que
no existe el estado intermedio que dejaba horas a medio registrar.

El filtro de entrada es `--pending`, no la fecha. El rango es un acotador
opcional.

Todo es local: no hay red, ni token, ni cuota. Un comando de lectura no cuesta
nada, así que consulta las veces que haga falta.

## Reglas duras

1. **No emitas ninguna llamada de escritura antes de una confirmación explícita.**
   Una respuesta ambigua se trata como "ajustar", nunca como "sí".
2. **Resuelve todos los mapeos de proyecto antes de escribir nada.** Si a mitad
   del flujo falta uno, ya habría issues creados y la interrupción dejaría el
   trabajo a medias.
3. **`bita link` es lo último de cada grupo.** Es el punto de commit: mientras
   la entrada no tenga su fila, el trabajo se considera no hecho. Perder horas es
   peor que duplicarlas, y esto es lo que evita perderlas.
4. **Nunca escribas en la base a mano.** Ni `sqlite3`, ni SQL suelto: el CLI es
   quien mantiene las invariantes (instantes en UTC, claves foráneas, ids).
5. **No encadenes comandos** con `|`, `;` ni `&&`, y no invoques el CLI con
   `pnpm run`: su banner rompería el parseo del JSON.
6. **La Historia es un contenedor, no una tarea.** No se le pone estimación, no
   se le añaden worklogs y **no se cierra nunca**: cerrarla dejaría huérfanas a
   las subtareas que vengan después. Solo la Subtarea se estima, se registra y se
   transiciona.
7. **Una sola Historia nueva por corrida sin preguntar.** Si el plan crea dos o
   más, para y enséñalas: casi siempre significa que la épica o el tema están
   mal. Jira no fusiona issues, así que una Historia duplicada se limpia moviendo
   subtareas a mano.
8. **Si `createJiraIssue` falla por jerarquía, para ese grupo.** No reintentes
   sin `parent`: una subtarea huérfana es inenrutable.
9. **No calcules fechas ni duraciones.** El CLI ya entrega `startedJira`,
   `timeSpent` y `totalHuman` listos. Cópialos literalmente.

## La ventana que sigue existiendo

No hay cuota que agotar, pero **Jira sigue siendo remoto**. El hueco entre
escribir el worklog y correr `bita link` es el único punto donde el estado puede
quedar partido, y sigue valiendo la regla: si algo falla ahí, ata igualmente las
entradas que sí llegaron y repórtalo. Los worklogs de Jira no se pueden borrar
con el conector.

## La jerarquía de Jira

Los niveles de este tenant: `Epic` = 1; `Historia`, `Tarea` y `Error` = 0;
`Subtarea` = −1. Un padre tiene que estar en un nivel **superior** al del hijo.

De ahí sale la consecuencia que manda en todo el flujo: **Historia y Tarea están
al mismo nivel, así que una Historia no puede contener Tareas. Solo Subtareas.**

```
Épica     (nivel  1)  el contenedor del proyecto, ya existe
  └─ Historia  (nivel  0)  el tema, inferido, se reusa entre corridas
       └─ Subtarea (nivel −1)  un grupo de bita, con sus worklogs
```

El tiempo se acumula solo hacia arriba: Subtarea → Historia → Épica.

| `hierarchy` | Cuándo | Qué se crea |
|---|---|---|
| `epic-story-subtask` | Por defecto | Historia bajo la épica; Subtareas bajo la Historia |
| `story-subtask` | El proyecto no tiene épica | Historia suelta; Subtareas bajo ella |
| `flat-task` | Solo si el usuario lo pide | Tarea suelta, como en la primera pasada |

Verificado en vivo: `VD-4961` es una Historia y obligó a crear Subtareas; las
épicas `INN-1213` e `INN-1216` aceptaron Tareas como hijas.

## Temas canónicos

Las Historias **solo** pueden llamarse como uno de los temas de
`meta.storyThemes`. No inventes nombres: es lo único que evita acabar con
«DevOps», «Dev Ops» e «Infraestructura» como tres Historias distintas.

Por defecto: DevOps · Backend · Frontend · Infraestructura · Análisis y
estimación · Seguridad · Soporte · Sesiones y reuniones · Documentación.

Si un trabajo no encaja en ninguno, **pregunta**; no crees un tema nuevo por tu
cuenta. La caché se indexa por el **id** del tema, así que renombrar el nombre
visible no rompe nada ni renombra Historias ya creadas.

## Procedimiento

### 0. Verificar

```
bita projects --json
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
bita summary --pending --json
```

Devuelve un envelope con `data.groups`. Cada grupo es **una tarea de Jira**:

- `summary` — el título tal cual lo escribió el usuario.
- `totalSeconds` / `totalHuman` — el tiempo real medido, que es lo que suman los worklogs.
- `estimateSeconds` / `estimateHuman` — **la estimación original**, redondeada hacia
  arriba al siguiente medio punto. Es este el que va a `timetracking`, no el total:
  3h 43m medidas se registran como 4h de estimación con worklogs que suman 3h 43m.
- `worklogs[]` — **un worklog por cada bloque de tiempo**, con su `startedJira`
  y su `timeSpent` ya formateados.
- `entryIds[]` — las entradas que hay que atar con `bita link` al terminar.
- `jiraProjectKey` — `null` si el proyecto aún no está mapeado.
- `partIndex` / `partCount` / `splitReason` — ver el tope de 8 horas.

En `meta` vienen `excluded`, `alreadyRegistered`, `unmappedProjects`,
`overlaps` y `warnings`.

### 3. Triaje

Reporta los cubos aunque no se procesen. Ninguno se escribe en Jira:

| Motivo | Qué hacer |
|---|---|
| `running` | Excluir. Di cuáles son (`bita ls`) y ofrece pararlos. Con varios cronómetros a la vez esto es normal, no un error. |
| `no-description` | No inventes título. Lista y pide uno, o déjalas pendientes. |
| `zero-duration` | Excluir: Jira rechaza worklogs de menos de un minuto. |
| `alreadyRegistered` | Solo se cuenta para el reporte. |

**`meta.overlaps`** no excluye nada: son los días donde el tiempo registrado
supera el tiempo de reloj cubierto, porque hubo cronómetros solapados. Está
permitido y es intencional. **Dilo en la propuesta** con las horas exactas: quien
lea el reporte en Jira verá un día de 10h y merece saber por qué.

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
bita map set <projectId> <JIRAKEY> --issue-type "Tarea"
bita map set <projectId> <JIRAKEY> --parent <JIRAKEY-123> --issue-type "Tarea"
```

**Varios proyectos pueden compartir tablero y diferir solo en el padre.**
Ese es el caso normal, no la excepción: el mapeo guarda `jiraProjectKey` y
`parentKey` por separado, y el CLI valida que el padre pertenezca al tablero.

**El padre no siempre es una épica.** Antes de mapearlo, léelo con `getJiraIssue`
y mira su `issuetype.hierarchyLevel`: nivel 1 es una Epic y puede tener Historias
o Tareas dentro; nivel 0 es una Historia o una Tarea y **solo puede tener
Subtareas**.

**La épica se pregunta una sola vez.** Un proyecto con `epicResolved: false` y sin
`jiraEpicKey` todavía no se ha preguntado: hazlo en este mismo bloque.

- Si te da una épica → `bita map set <id> <KEY> --parent <KEY-123>`, y el
  trabajo será `Subtarea` bajo una Historia dentro de esa épica.
- Si dice que **no hay épica** → guárdalo igual con `--no-epic`, que marca
  `epicResolved: true`. A partir de ahí la Historia se crea suelta y las
  subtareas cuelgan de ella. **No vuelvas a preguntar por ese proyecto.**

Sin ese `epicResolved`, los proyectos sin épica se preguntarían en cada corrida
para siempre, que es justo lo que este flujo no debe hacer.

Los proyectos ya mapeados se resuelven en silencio: **no vuelvas a preguntar por
ellos nunca**. Si el usuario cancela a mitad del bloque, aborta la corrida entera.

Entradas **sin proyecto**: no les inventes destino. Lístalas aparte y
ofrece asignarles uno solo para esta corrida, o dejarlas pendientes.

### 5.5. Resolver la Historia de cada grupo

Antes de crear nada:

1. Elige el tema de la lista cerrada. La señal más fuerte es la **nota rica**
   del grupo (`notes[]`): dice qué archivos y comandos se tocaron. Después el
   título, el repo y la rama. El proyecto acota, no decide.
2. ¿`jiraStories[themeId]` ya tiene una key? → úsala, sin buscar.
3. Si no, trae las Historias de la épica y **empata por igualdad exacta
   normalizada** (trim, espacios, acentos, minúsculas) contra el nombre canónico:

   ```
   project = <KEY> AND issuetype = Historia AND parent = <épica> ORDER BY created DESC
   ```

   **Nunca decidas con `summary ~`.** Tokeniza: «Infraestructura» empata
   «Infraestructura de pruebas del cliente». Sirve para avisar, no para elegir.

   Sin épica (`hierarchy: story-subtask`), añade `AND parent IS EMPTY AND
   reporter = currentUser()`: sin épica que acote, el riesgo de reusar la
   Historia de otro es real.
4. Si no hay empate, propón crearla. Al confirmar, créala y **persiste la
   referencia en el mapeo de inmediato**, antes de tocar ninguna subtarea:
   `bita map story <projectId> <themeId> <ISSUE-KEY>`.

Si un grupo mezcla notas de temas distintos, gana el mayoritario y **dilo en la
propuesta**: suele ser un cronómetro que se dejó correr a través de un cambio de
tema.

### 6. Preflight por proyecto

Una vez por combinación de proyecto y tipo de issue:

- `getJiraProjectIssueTypesMetadata` → el id del tipo. **Los tipos están en
  español**: "Tarea", "Historia", "Error", "Subtarea", "Epic". Nunca asumas "Task".
- `getJiraIssueTypeMetaWithFields` → si `timetracking` está en la pantalla, y qué
  campos son obligatorios.

Si el proyecto no expone `timetracking`, **registra el worklog igual** y salta la
estimación. Avísalo una vez por proyecto, no una por issue.

### 7. Propuesta y confirmación

Tabla con una fila por tarea: proyecto → Jira, tipo, resumen, número de
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

0. **La Historia ya está resuelta** en el paso 5.5 y persistida en el mapeo.
   Si tuviste que crearla, no le pongas estimación ni la cierres nunca.
1. `createJiraIssue` para el trabajo, como **`jiraWorkIssueTypeName`**
   (`"Subtarea"` por defecto) con `parent` = la key de la Historia.
   `issueTypeName` va por **nombre**, no por id.
   - `summary`: el del grupo, **literal**, sin reescribir. Es la clave de
     agrupación y lo que el usuario reconocerá al buscar.
   - `description`: si el grupo trae `notes[]`, úsalas — el resumen en prosa
     primero y después las viñetas de archivos, comandos y recursos tocados.
     Cierra siempre con la tabla de bloques y los ids de las entradas. Sin
     notas, solo la tabla, que es lo que había antes.
   - `timetracking` con `originalEstimate` = `estimateHuman` y
     `remainingEstimate: "0m"` puede ir ya en la creación; ahorra una llamada.
2. Solo si el proyecto no admitía `timetracking` en la pantalla de creación,
   `editJiraIssue` con los mismos valores. **Siempre antes del worklog**: algunos
   workflows bloquean la edición una vez cerrado el issue, y el tool de worklog
   no expone `adjustEstimate`, así que fijar el cero explícitamente es correcto
   tanto si Jira decrementa solo como si no.
3. `addWorklogToJiraIssue` **una vez por cada entrada de `worklogs[]`**, copiando
   `startedJira` y `timeSpent`. En `commentBody`, el rastro de auditoría:
   `bita · <startLocal> · bita:<entryId>`.
4. Si toca cerrar: `getTransitionsForJiraIssue` y elige **por lo que devuelva**,
   nunca por nombre a ciegas. Ver abajo.
5. `bita link <entryIds...> --issue <ISSUE-KEY>`, en una sola llamada por grupo.
   Es una transacción local: o quedan atadas todas o ninguna.

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

## El cronómetro en vivo

### Cuándo proponerlo

El criterio es **la forma del resultado, no la del prompt**. Propón cronómetro
cuando la sesión vaya a dejar un **artefacto**: un commit, un archivo, un recurso
desplegado, una migración, una MR, una causa raíz diagnosticada. No lo propongas
cuando solo vaya a producir una respuesta: explicar, leer, buscar, comparar.

**La regla puente:** si el trabajo va a entrar en un worktree, propón el
cronómetro. El `CLAUDE.md` del usuario ya define que toda tarea que modifique el
repo va en su propio worktree y que leer no lo necesita. Ese límite ya existe.

Propón **cuando el trabajo empieza**, justo antes de la primera edición, no
cuando se menciona el tema: si no, el reloj corre durante la deliberación. Una
sola vez por tema, en una línea. Si dice que no, no vuelvas a preguntar en esa
sesión. **Nunca arranques sin un sí explícito.**

### Arrancar

```
bita start                    # en blanco, al principio de la sesion
bita start "<título corto>"   # o con titulo, si ya se sabe
```

El título es la clave de agrupación y el summary del issue: corto y reconocible.
El proyecto sale del repo mapeado; si no lo está, el CLI falla con
`REPO_NOT_MAPPED` y el comando exacto para arreglarlo. La entrada nace sin fila en
`jira_links`, así que ya está pendiente en este pipeline.

**Pueden correr varios cronómetros a la vez** y `start` nunca se niega. Eso es
deliberado: mide dos trabajos en paralelo en vez de forzar una elección falsa.

### Varios a la vez, y cuándo partir

1. **Cambia el proyecto → arranca otro cronómetro.** El proyecto elige el
   tablero; equivocarse manda horas al equipo de al lado.
2. Mismo proyecto, tema distinto, y lo nuevo dura ≥20 min → arranca otro.
3. Mismo proyecto, mismo tema → déjalo correr.
4. Interrupciones de menos de ~10 min → déjalo correr. Partir en bloques de
   cuatro minutos hace los worklogs ilegibles y caen en `zero-duration`.

**Solo cuenta el tiempo atendido.** Un despliegue que tarda 40 minutos solo con
el usuario encima cuenta; si se fue, no. Ante la duda, pregunta antes de parar.

Con varios corriendo, `bita ls` los enseña con su id. Para saber qué hay abierto
antes de proponer nada, míralo: es gratis.

### Parar

Escribe la nota en un archivo temporal y para en **un solo comando**, para que la
nota no pueda colgarse de la entrada equivocada:

```json
{
  "body": "Resumen en prosa de qué se hizo y por qué, 2-4 frases.",
  "artifacts": {
    "files": ["src/x.ts", "terraform/dev/main.tf"],
    "commands": ["terraform apply", "pnpm test"],
    "resources": ["https://…"]
  }
}
```

```
bita stop <id> --note-json /tmp/nota.json
```

**Pasa siempre el id cuando haya más de uno corriendo.** Sin id y con varios
abiertos, `stop` falla con `AMBIGUOUS_TIMER` en vez de adivinar. `--all` los para
todos, pero entonces la nota no se escribe: una nota pertenece a un trabajo.

Nada de prosa por `argv`: el quoting se rompe y el texto queda en `ps`.

**La nota acaba en la descripción de un issue de Jira que verán otros.** Antes de
publicarla, revisa que no lleve rutas absolutas con nombres internos, secretos ni
pegotes de log.

## Manejo de fallos

| Falla en | Qué queda | Qué hacer |
|---|---|---|
| `createJiraIssue` | Nada escrito, entradas pendientes | Reintentar es seguro |
| `timetracking` | Issue sin estimación | Continuar sin ella y avisar |
| worklog **parcial** | Issue con worklogs incompletos | `bita link` **solo** las entradas que sí quedaron, anotar la key, reanudar sobre ese issue |
| transición | Issue correcto, abierto | **Atar igual**: el tiempo ya está registrado, y dejarlas pendientes duplicaría worklogs |
| `bita link` | Jira sí, bita no | **Detén la corrida entera** y enseña el comando exacto para repararlo |

`bita link` es local y transaccional, así que fallar ahí es raro: significa que la
base no se puede escribir. Cuando pase, el tiempo ya está en Jira y las entradas
siguen pendientes, así que **una segunda corrida duplicaría los worklogs**.
Adviértelo explícitamente. Los worklogs de Jira **no se pueden borrar** con el
conector, así que un duplicado se limpia a mano en la UI.

Si te equivocaste de issue, `bita link <ids> --unlink` devuelve las entradas a
pendientes; el worklog de Jira hay que quitarlo a mano.

Antes de crear un issue, un `searchJiraIssuesUsingJql` de aviso
(`project = X AND summary ~ "..." AND reporter = currentUser() AND created >= -30d`)
detecta posibles duplicados. **Avisa, no decide**: es una búsqueda difusa.

## Resumen final

Una fila por tarea con cinco marcas — crear, estimar, worklog, cerrar, atar —
el enlace al issue y el total. Cualquier inconsistencia va **arriba**, no al final.

## Reglas de agrupación

Esta sección es editable a mano; es la palanca principal para ajustar el
comportamiento.

- Clave de agrupación: **proyecto + título**, a lo largo de todo el rango.
  Un grupo puede cruzar días y no se parte por eso.
- El título se compara sin espacios de más y sin puntuación final; por defecto **se
  distinguen mayúsculas** (`--case-insensitive` las une).
- El CLI **no fusiona por similitud**. "Refactor pagos" y "refactor de pagos" son
  dos tareas. Si ves títulos casi iguales, sugiere la fusión en la propuesta y
  deja que decida el usuario.
- Cuidado con títulos genéricos ("daily", "junta", "soporte"): pueden colapsar
  semanas en un issue gigante. El rango de fechas por grupo lo hace visible en la
  propuesta.
