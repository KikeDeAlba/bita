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
3. Al terminar el plan, escribe el primer checkpoint del documento con lo que
   concluyó: `bita note path <id> --create`, edítalo, `bita note save <id>`.

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
6. **La Historia y la Épica son contenedores, no tareas.** No se les pone
   estimación, no se les añaden worklogs, **no se les pone persona asignada ni
   fecha de inicio** y **no se cierran nunca**: cerrar la Historia dejaría huérfanas a las subtareas
   que vengan después. Solo el issue de trabajo —Subtarea o Tarea— se estima, se
   registra, **se asigna**, **se fecha** y se transiciona.
7. **Una sola Historia nueva por corrida sin preguntar.** Si el plan crea dos o
   más, para y enséñalas: casi siempre significa que la épica o el tema están
   mal. Jira no fusiona issues, así que una Historia duplicada se limpia moviendo
   subtareas a mano.
8. **Si `createJiraIssue` falla por jerarquía, para ese grupo.** No reintentes
   sin `parent`: una subtarea huérfana es inenrutable.
9. **No calcules fechas ni duraciones.** El CLI ya entrega `startedJira`,
   `timeSpent` y `totalHuman` listos. Cópialos literalmente.
10. **Nada de lo que se publica delata la conversación.** Los documentos y las
    descripciones de Jira se escriben como documentación técnica, no como el
    acta de un chat. Ver "Cómo se escribe lo que se publica".

## Cómo se escribe lo que se publica

El documento de la entrada y la descripción del issue los va a leer gente que no
estuvo aquí, meses después, buscando por qué algo está como está. Tienen que
leerse como la bitácora técnica de quien hizo el trabajo. **Nada en el texto
puede delatar que hubo una conversación, ni quién pidió qué, ni que lo escribió
un asistente.**

### Lista negra

Si una de estas aparece en el texto, la frase está mal y hay que reescribirla
entera, no suavizarla:

- **Quién lo pidió**: "por decisión del usuario", "se acordó con el usuario", "a
  petición del usuario", "según lo solicitado", "el usuario pidió / indicó /
  confirmó / prefirió", "como se solicitó".
- **La conversación**: "en esta sesión", "durante la conversación", "en el
  chat", "como se comentó", "se revisó junto con", "se validó con".
- **Primera persona de charla**: "decidimos", "acordamos", "vimos que", "nos
  dimos cuenta", "optamos por", "revisamos".
- **Relleno burocrático**: "se procedió a", "se llevó a cabo la tarea de", "se
  realizó la implementación de", "cabe destacar", "es importante señalar", "como
  se mencionó anteriormente".
- **Hedging**: "creo que", "parece que", "aparentemente", "podría ser que", "en
  principio", "al parecer", "se asume que".
- **El asistente**: "asistente", "Claude", "IA", "generado automáticamente",
  "agente", y cualquier nombre de herramienta del agente.
- **Narración del tanteo**: "se intentó varias veces", "después de varios
  intentos", "tras probar distintas opciones".

### Así no / así sí

| Así no | Así sí |
|---|---|
| Por decisión del usuario se fijó el tope en 8 horas. | El tope por tarea es de 8 horas: Jira rechaza worklogs mayores en una sola entrada. |
| Se acordó usar colas en lugar de procesar en línea. | El procesamiento pasa a una cola: en línea, un pico de reservas bloqueaba las respuestas de la API. |
| Según lo solicitado, se agregó validación al endpoint. | El endpoint valida el id del apartado antes de encolar; sin validación, un id vacío llegaba hasta el consumidor. |
| Se procedió a la migración de la tabla de pagos. | La tabla de pagos se migró a `payments_v2`. |
| Creo que el problema era el token expirado. | El SDK devuelve 200 con cuerpo vacío cuando el token expiró; ese era el fallo. |
| Después de varios intentos logramos que pasaran las pruebas. | `pnpm test`: 148 pasan, 0 fallan. |
| El usuario prefirió no tocar el front en esta iteración. | El front queda fuera de alcance; sigue esperando 201 y funciona con 202. Anotado en Pendiente. |
| Se analizó el código y se detectaron varios problemas. | `QUEUE_URL` del entorno de dev apunta a la cola de staging desde marzo. |

### Cómo se escribe entonces

- Voz impersonal en pasado ("se migró", "se añadió") o sujeto técnico ("el
  worker reintenta cinco veces"). Nunca "yo" ni "nosotros".
- **Una afirmación es un hecho comprobable.** Si no se comprobó, no se atenúa:
  se va a "Pendiente".
- **Las decisiones se justifican por su razón técnica, no por su origen.** Si la
  razón real es una preferencia de negocio, se escribe como restricción ("el
  reporte exige bloques de 8 h"), no como autoría.
- El resultado, no el camino. Excepción: "Hallazgos", donde el camino es el
  valor, pero escrito como hecho, no como anécdota.

### La prueba de olfato

Antes de guardar el documento y otra vez antes de crear el issue, lee cada
párrafo y pregunta:

1. **¿Esto lo escribiría alguien en su bitácora técnica, sin haber estado en la
   conversación?** Si suena a acta de reunión, fuera.
2. **Si borro la primera mitad de la frase, ¿se pierde información técnica?** Si
   no se pierde nada, esa mitad era relleno o era la conversación.
3. **¿Queda alguna palabra de la lista negra?** Si sí, reescribe la frase
   completa: cambiarle el sujeto no la arregla.

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

**Guarda su `account_id`.** Es el que va en `assignee` de cada issue de trabajo
que crees. Sin él la tarea nace sin dueño: no sale en el tablero de quien hizo
el trabajo ni en los reportes de carga, y las horas quedan colgando de nadie.

**Confirma también el id del campo «Fecha de inicio»** una vez por corrida, con
`getJiraIssueTypeMetaWithFields`. En este tenant es `customfield_10015`, pero es
un campo personalizado y su id puede no ser el mismo en otro sitio; comprobarlo
cuesta una llamada y equivocarse deja la fecha en blanco sin avisar.

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

1. Elige el tema de la lista cerrada. La señal más fuerte es el **documento**
   del grupo (`docs[]`): «Contexto» dice por qué se hizo y «Tocado» con qué.
   Después el título, el repo y la rama. El proyecto acota, no decide.
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
4. Si no hay empate, propón crearla. Al confirmar, créala **sin `assignee`** —es
   un contenedor, no trabajo de nadie— y **persiste la referencia en el mapeo de
   inmediato**, antes de tocar ninguna subtarea:
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
   - `description`: se **construye** desde `docs[]`, no se copia. Quita el front
     matter y quita el H1 —el H1 es el summary y repetirlo es ruido— y deja las
     secciones en su orden, omitiendo las vacías. En «Tocado», los archivos
     salen de `touchedFiles` del grupo, no del documento. Cierra **siempre** con
     la tabla de bloques y los ids de las entradas. Si un documento viene con
     `markdown: null` y `truncated: true`, léelo de su `path` con Read. Un grupo
     sin documento pero con archivos tocados da solo «Tocado» y la tabla.
     **Antes de enviarla, pásale la prueba de olfato**: es el texto que verán
     otros.

     **Con varios documentos en un grupo no los concatenes**, que produciría
     siete «Contexto» seguidos. Se funden sección por sección, en orden
     cronológico: Contexto el del más antiguo; Qué se hizo, Decisiones y
     Hallazgos en unión sin duplicados; Verificación, **el último resultado**
     por comprobación, porque una prueba que falló el martes y pasó el jueves se
     publica como pasó; Pendiente en unión **menos lo que un documento posterior
     ya resolvió**, porque un pendiente resuelto que llega a Jira manda a
     alguien a rehacer trabajo hecho. Si dos se contradicen, gana el posterior y
     el anterior se cae.
   - `assignee`: **siempre**, con el `accountId` del paso 0. Es la única pieza
     del payload que Jira no deduce de nada y que nadie echa en falta hasta que
     busca su propio trabajo y no lo encuentra.
   - **Fecha de inicio** (`customfield_10015` en este tenant): **siempre**, con
     `days[0]` del grupo, en `YYYY-MM-DD`. Es el día en que empezó el trabajo,
     no el día en que se registró: sin ella, los informes y las vistas de
     cronograma colocan la tarea el día del volcado, que puede ser semanas
     después.
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

### El documento de la entrada

Cada entrada tiene un documento en markdown. Vive bajo la raíz de documentos, en
espejo del proyecto: `<proyecto>/<año>/<mes>/<día>-<id>-<titulo>.md`. La base de
datos guarda su **ruta**, no su texto, así que el archivo es el original y se
puede abrir, mover de máquina o respaldar por su cuenta.

**La ruta la da el CLI, nunca la inventes.** Corren varios cronómetros a la vez
y varias sesiones a la vez: una ruta fija sería dos sesiones escribiendo el
mismo archivo y dos trabajos distintos acabando en el mismo issue.

```
bita note path <id> --create   la ruta, creando el esqueleto si no existe
bita note save <id>            registrarlo después de editarlo
```

El CLI estampa por su cuenta el proyecto, el día, el inicio, el fin, la duración,
el repositorio y la rama. Tú escribes el cuerpo y nada más. Las secciones son
estas, y en este orden:

| Sección | Qué responde |
|---|---|
| **Contexto** | Por qué existió esto. Lo único que no se reconstruye del diff |
| **Qué se hizo** | Qué cambió. Viñetas de resultado, no de edición |
| **Decisiones** | Por qué así y no de la otra forma, con la alternativa descartada |
| **Hallazgos** | Qué no era obvio: comportamiento raro, límite del entorno, causa raíz |
| **Verificación** | Comando → resultado real. No «pasó» |
| **Pendiente** | Qué falta, qué falló, el siguiente paso |
| **Tocado** | Comandos y recursos. Los archivos los registra el hook, no los repitas |

Contexto, Qué se hizo y Pendiente van siempre. Decisiones y Hallazgos se omiten
enteras si están vacías: una sección con «N/A» es ruido. GFM plano, sin macros
ni HTML, y el H1 igual al título.

### Checkpoints: escribir mientras el reloj corre

**El documento no se escribe al parar.** Al parar ya no te acuerdas del porqué,
y el porqué es la mitad del valor.

Escribe un checkpoint al cerrar un paso que dejó algo en disco, al terminar una
verificación —saliera bien o mal—, al cambiar de enfoque, al encontrar algo no
obvio, y cuando algo quede fuera. El de «cambiar de enfoque» es el que más se
olvida y el único que no se puede reconstruir después.

No escribas uno por cada edición: se documenta el resultado, no la edición. Un
bloque de dos horas sano tiene entre tres y seis checkpoints; si llevas doce,
estás narrando la sesión. Uno cabe en una a tres viñetas.

Añade **a la sección que toque** —un hallazgo va a Hallazgos aunque estuvieras
editando código— y no reescribas lo anterior salvo que resultara falso.

El hook `checkpoint` avisa cuando un cronómetro lleva tres archivos tocados o
cuarenta y cinco minutos sin documentar, y se calla solo en cuanto lo guardas.

### Parar

Cierra el documento —completando Verificación y Pendiente, que solo se pueden
escribir al final— y para:

```
bita note save <id>
bita stop <id>
```

**Pasa siempre el id cuando haya más de uno corriendo.** Sin id y con varios
abiertos, `stop` falla con `AMBIGUOUS_TIMER` en vez de adivinar. `--all` los para
todos, pero entonces no se cierra ningún documento: un documento pertenece a un
trabajo.

Nada de prosa por `argv`: el quoting se rompe y el texto queda en `ps`. El
documento se edita como archivo, siempre.

**El documento acaba en la descripción de un issue de Jira que verán otros.**
Antes de guardarlo, revisa que no lleve rutas absolutas con nombres internos,
secretos ni pegotes de log, y pásale la prueba de olfato de «Cómo se escribe lo
que se publica».

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

Una fila por tarea con siete marcas — crear, **asignar**, **fechar**, estimar,
worklog, cerrar, atar — el enlace al issue y el total. Cualquier inconsistencia
va **arriba**, no al final.

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
