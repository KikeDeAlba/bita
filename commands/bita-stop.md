---
description: Para un cronómetro de bita cerrando el documento de lo que se hizo
argument-hint: [id, vacío si solo hay uno, o "all"]
allowed-tools: Bash(bita stop:*), Bash(bita ls:*), Bash(bita note:*), Read, Write, Edit
---

Corriendo ahora mismo:

!`bita ls`

Para el cronómetro y **cierra el documento de lo que realmente se hizo**. Ese
documento acaba en la descripción del issue de Jira, así que es la parte que
importa: sin él el issue queda con un título y nada más.

**Cuál parar.** `$ARGUMENTS` manda. Si viene vacío:

- Un solo cronómetro corriendo → ese.
- Varios → **pregúntame cuál**, listándolos con su id y su tiempo. No adivines:
  el documento que vas a cerrar pertenece a un trabajo concreto y colgarlo del
  equivocado lo vuelve mentira.
- Si viene `all`, para todos con `bita stop --all` y **no escribas ningún
  `--did`**: un bloque pertenece a un solo trabajo.

**Lo que pasó** va en una línea o dos, en pasado, al parar:

```
bita stop <id> --did "<qué pasó en este bloque>"
```

El resultado, no la edición. La fecha y la duración no se escriben: ya están
medidas.

**Y una última pasada por la página.** Lo que antes ibas a escribir como
«Verificación» se dice ahora en presente, como se verifica hoy, sustituyendo lo
que dijera antes. Lo que ibas a dejar en «Pendiente» se convierte en un límite
conocido de la página o en un issue de Jira, nunca en un TODO enterrado en la
prosa.

Si la página no se tocó en todo el bloque, escríbela ahora: qué es, cómo
funciona y cómo se verifica.

**Antes de cerrar, relee la página.** Que no lleve secretos, rutas absolutas con nombres
internos ni pegotes de log. Y pásale la prueba de olfato de la skill: nada de
«se acordó con el usuario», «según lo solicitado», «decidimos» ni «creo que».
Lo van a leer otros en Jira.

Responde con el id, el título, el tiempo que quedó registrado, la página a la
que quedó colgado y, si siguen corriendo otros, cuáles.
