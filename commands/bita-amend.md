---
description: Rellena el título, el proyecto o la nota de un cronómetro
argument-hint: [id, o vacío para el borrador en curso]
allowed-tools: Bash(bita amend:*), Bash(bita ls:*), Bash(bita projects:*), Bash(bita repo show:*), Bash(bita scope list:*), Write
---

Corriendo ahora:

!`bita ls`

Rellena lo que le falte a un cronómetro. Normalmente esto pasa solo, pero sirve
para forzarlo o para corregir algo.

**Cuál.** `$ARGUMENTS` manda. Si viene vacío, `--draft` apunta al único borrador
en curso; si hay varios, el comando falla y te dice los ids, así que pregúntame
cuál en vez de adivinar.

**El título** sale de lo que se esté haciendo en esta sesión: corto, reconocible
y en el idioma en que se buscaría después. Es la clave de agrupación y el summary
del issue de Jira.

**El proyecto.** Cuidado aquí: un repo no es un proyecto. Los proyectos son
grupos con varios repos dentro. Resuélvelo con `bita repo show`, que dice qué
prefijo empató, y no lo fuerces a mano si ya resuelve solo.

```
bita amend --draft --title "<titulo>" --project <nombre o id>
bita amend <id> --title "<titulo>"
```

**La descripción**, si ya hay material para escribirla, va en un archivo y se
adjunta. Los archivos que se tocaron se registran solos, así que no los repitas:
concéntrate en el porqué.

```json
{ "body": "Resumen en prosa de qué se hizo y por qué, 2-4 frases." }
```

```
bita amend <id> --note-json /tmp/bita-note.json
```

Antes de escribirla, revisa que no lleve secretos ni rutas internas: acaba en un
issue de Jira que verán otros.

Responde en una línea con lo que quedó.
