---
description: Anota un checkpoint en el documento del cronómetro que está corriendo
argument-hint: [id, vacío si solo hay uno]
allowed-tools: Bash(bita ls:*), Bash(bita note:*), Read, Write, Edit
---

Corriendo ahora mismo:

!`bita ls`

Escribe en el documento de la entrada lo que ha pasado desde el último
checkpoint. **El documento no se escribe al parar**: al parar ya no te acuerdas
del porqué, y el porqué es la mitad del valor.

**Cuál.** `$ARGUMENTS` manda. Si viene vacío y solo hay uno corriendo, ese; si
hay varios, **pregúntame cuál**. Un checkpoint colgado del cronómetro
equivocado convierte dos documentos en mentira.

**Qué entra**, y solo si es un resultado:

- un paso cerrado que dejó algo en disco → **Qué se hizo**
- una verificación terminada, saliera bien o mal → **Verificación**, con el
  resultado real, no con «pasó»
- un cambio de enfoque → **Decisiones**, con la alternativa descartada y el
  motivo
- algo no obvio —comportamiento raro, límite del entorno, causa raíz— →
  **Hallazgos**
- algo que quedó fuera o a medias → **Pendiente**

**Qué no entra.** Una edición no es un checkpoint. Los archivos tocados se
registran solos: **no los escribas a mano**. Una a tres viñetas; si necesitas
más, son dos checkpoints o es el resumen final disfrazado.

**Cómo.** En tres pasos:

```
bita note path <id> --create
```

Lee el documento, **añade a la sección que toque** —no siempre es «Qué se
hizo»— y no reescribas lo anterior salvo que resultara falso. Después:

```
bita note save <id>
```

**Escríbelo como documentación técnica, no como acta.** Nada de «se acordó con
el usuario», «según lo solicitado», «decidimos» ni «creo que»: esto acaba en un
issue de Jira que leerán otros. Si no se comprobó, va a Pendiente, no atenuado.

Responde en una línea: a qué sección añadiste y cuántas viñetas. Nada más.
