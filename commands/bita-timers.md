---
description: Muestra los cronómetros de bita que están corriendo y lo de hoy
allowed-tools: Bash(bita ls:*), Bash(bita entries:*)
---

Corriendo ahora:

!`bita ls`

Hoy:

!`bita entries today`

Resume en dos o tres líneas: qué está corriendo y desde cuándo, y cuánto llevas
hoy en total. Si el aviso de solapes apareció arriba, dilo con las horas exactas
y no lo escondas. Si no hay nada corriendo, dilo y para ahí.

Si algún cronómetro lleva archivos tocados sin checkpoint, dilo con su id y
cuántos, y ofrece `/bita-check`. Si todos están al día, no lo menciones.
