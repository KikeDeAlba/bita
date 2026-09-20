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
- Si viene `all`, para todos con `bita stop --all` y **no cierres ningún
  documento**: un documento pertenece a un solo trabajo.

**El documento.** Su ruta sale de `bita ls`, y si aún no existe:

```
bita note path <id> --create
```

Si ya lleva checkpoints, **ciérralo, no lo reescribas**: añade lo que falte y
completa las dos secciones que solo se pueden escribir al final.

- **Verificación**: comando → resultado real. `pnpm test`: 148 pasan, 0 fallan.
  No «pasó». Lo que no se comprobó no va aquí.
- **Pendiente**: lo que quedó fuera, lo que falló, el siguiente paso. **Nunca
  se deja vacía**: su ausencia se lee como «no quedó nada» y casi nunca es
  verdad. Si de verdad no quedó nada, escríbelo.

Si no hay ni un checkpoint, escríbelo entero ahora: Contexto, Qué se hizo,
Verificación y Pendiente, y Decisiones y Hallazgos si las hubo.

**Antes de guardar, relee.** Que no lleve secretos, rutas absolutas con nombres
internos ni pegotes de log. Y pásale la prueba de olfato de la skill: nada de
«se acordó con el usuario», «según lo solicitado», «decidimos» ni «creo que».
Lo van a leer otros en Jira.

Después:

```
bita note save <id>
bita stop <id>
```

Responde con el id, el título, el tiempo que quedó registrado, la ruta del
documento y, si siguen corriendo otros, cuáles.
