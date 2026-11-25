# Muestra histórica Facebook — DEV únicamente

Autorización del usuario: importar una muestra pequeña, cifrada e identificada
como histórica; evaluar sin responder. Primera muestra limitada a un comentario.

`import_history` usa el mismo JWT/rol y conexión aislada, valida token/identidad,
lee como máximo diez publicaciones propias y diez comentarios por publicación.
Sólo importa un comentario anterior al inicio de la vigilancia orgánica. No sigue
URLs de paginación, no renueva tokens y sólo realiza GET contra Meta.

Se conserva la fecha original y se cifra texto e identificadores. `meta_history_v1`
figura dentro del contenido autenticado y en metadata; el lector exige coincidencia.
La referencia fija de esta muestra y la PK existente limitan la captura a una fila
inmutable incluso con solicitudes concurrentes. No se fabrica payload webhook ni
firma Meta. La vigilancia excluye explícitamente estos registros.

Sin migraciones o cambios de RLS, receiver, secretos o Producción. Las propuestas
conservan la etiqueta histórica; el panel muestra que no acredita entrega orgánica.
La evaluación reutiliza la comprobación de respuestas externas y propiedad
verificada; falta de evidencia implica escalamiento, no información inventada.

Meta omitió from.id en seis comentarios leídos. Esto no invalida la pertenencia
acreditada a la publicación propia. Se permite conservar el comentario con autor
explícitamente desconocido: author_verified=false, own_author=null; nunca se crea
una identidad. El clasificador bloquea propuestas y escala cualquier intención
comercial con autor no verificado. No cambia autorización, RLS o scopes.

Pruebas locales: 93/93 PASS (incluye seis casos nuevos de importación, cifrado,
deduplicación, procedencia alterada, publicación ajena y exclusiones).
