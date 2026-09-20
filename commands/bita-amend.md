---
description: Rellena el título, el proyecto o la nota de un cronómetro
argument-hint: [id, o vacío para el borrador en curso]
allowed-tools: Bash(bita amend:*), Bash(bita ls:*), Bash(bita note:*), Bash(bita projects:*), Bash(bita repo show:*), Bash(bita scope list:*), Read, Write, Edit
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

Al titular un borrador, el documento de la entrada nace y se mueve a su nombre
definitivo. Es el único momento en que cambia de ruta: a partir de ahí el título
vive dentro del archivo y el archivo ya no se mueve.

**La descripción no va aquí.** Vive en el documento, y se escribe por
checkpoints mientras el trabajo pasa: para eso está `/bita-check`. `amend` es
para los metadatos —título y proyecto— y para corregir un hecho que resultó
falso. Los archivos que se tocaron se registran solos, así que no los repitas:
concéntrate en el porqué.

Si hay que corregir algo del documento, léelo y edítalo en su sitio:

```
bita note path <id>
bita note save <id>
```

Antes de guardar, revisa que no lleve secretos ni rutas internas: acaba en un
issue de Jira que verán otros.

Responde en una línea con lo que quedó.
