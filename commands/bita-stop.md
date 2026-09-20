---
description: Para un cronómetro de bita escribiendo la nota de lo que se hizo
argument-hint: [id, vacío si solo hay uno, o "all"]
allowed-tools: Bash(bita stop:*), Bash(bita ls:*), Write
---

Corriendo ahora mismo:

!`bita ls`

Para el cronómetro y **escribe la nota de lo que realmente se hizo**. La nota
acaba en la descripción del issue de Jira, así que es la parte que importa: sin
ella el issue queda con un título y nada más.

**Cuál parar.** `$ARGUMENTS` manda. Si viene vacío:

- Un solo cronómetro corriendo → ese.
- Varios → **pregúntame cuál**, listándolos con su id y su tiempo. No adivines:
  la nota que vas a escribir pertenece a un trabajo concreto y colgarla del
  equivocado la vuelve mentira.
- Si viene `all`, para todos con `bita stop --all` y **no escribas nota**: una
  nota pertenece a un solo trabajo.

**La nota.** Escríbela en `/tmp/bita-note.json` a partir de lo que pasó en esta
sesión, no de lo que el título promete:

```json
{
  "body": "Resumen en prosa de qué se hizo y por qué, 2-4 frases.",
  "artifacts": {
    "files": ["src/x.ts"],
    "commands": ["pnpm test"],
    "resources": ["https://..."]
  }
}
```

- `body` en prosa: qué se resolvió, y el porqué si no es obvio. Si algo quedó a
  medias o falló, **dilo ahí**; es la información que más se agradece después.
- `files` y `commands`: lo que de verdad se tocó en esta sesión. No los inventes
  ni los infles.
- **Antes de escribirla, revisa que no lleve secretos, rutas absolutas con
  nombres internos ni pegotes de log.** La van a leer otros en Jira.

Después, en un solo comando:

```
bita stop <id> --note-json /tmp/bita-note.json
```

Responde con el id, el título, el tiempo que quedó registrado y, si siguen
corriendo otros, cuáles.
