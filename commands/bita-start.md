---
description: Arranca un cronómetro de bita para el trabajo que empieza
argument-hint: [título corto, o vacío para que lo infiera]
allowed-tools: Bash(bita start:*), Bash(bita ls:*), Bash(bita projects:*), Bash(bita repo show:*)
---

Corriendo ahora mismo:

!`bita ls`

Repositorio y proyecto:

!`bita repo show`

Arranca un cronómetro de bita para el trabajo que empieza.

**El título** es `$ARGUMENTS`. Si viene vacío, propón uno tú a partir de lo que
estamos haciendo en esta sesión y **enséñamelo antes de arrancar**: es la clave de
agrupación y el summary del issue de Jira, así que tiene que ser corto,
reconocible y en el idioma en que lo buscaría después. Si viene con texto, úsalo
literal, sin reescribirlo.

**Antes de arrancar**, mira la lista de arriba:

- Si ya hay un cronómetro con este mismo título y proyecto, no arranques otro.
  Dímelo y ya.
- Si hay otros corriendo pero de otra cosa, **arranca igual**: bita admite varios
  a la vez y eso es deliberado. Solo menciónalo en una línea.
- Si `bita repo show` dice que el repo no está mapeado, no inventes proyecto:
  enséñame el comando `bita repo set . <projectId>` y la lista de `bita projects`
  para que elija.

Después:

```
bita start "<título>"
```

Responde en una sola línea: el id que devolvió, el título y el proyecto. Nada más.
