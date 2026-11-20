# Diagnóstico real de asociación Facebook / inventario DEV

2026-10-21. PR #256, exclusivamente conexión aislada Emporio Comentarios DEV.

Consulta autenticada desde Preview, Graph v26.0, sólo GET y sin renovar tokens.
Las primeras 10 publicaciones propias carecen de URL http(s) reconocible en su
campo message. Ampliación acotada a 30: las 30 tienen el mismo resultado.
Los adjuntos de esas 30 tampoco contienen una URL aceptada por el contrato
`https://[www.]emporioinmobiliario.com.mx/propiedades/EMP-...`.
Se comprobaron url/unshimmed_url conforme a la referencia oficial Story Attachment
v26.0, leída en Meta Developers. No se siguen redirecciones ni URLs externas.

DEV: 124 propiedades; 110 published, todas con public_id. social_message_routes:
0 filas, 0 relaciones previas source_post_id/source_property_id. No se usaron
títulos, ubicaciones, precios, imágenes ni proximidad temporal para inferir vínculo.

Resultado real: 0 asociaciones exactas en esta muestra, 0 importaciones nuevas,
0 propuestas nuevas. Hay más publicaciones fuera de la muestra; esto no prueba
ausencia global. Para certificar se necesita una publicación con referencia exacta
a una ficha existente en DEV, o evidencia y autorización explícita de un vínculo
publicación/ficha; no se ha creado ninguno.

Diagnóstico separa mensaje ausente, sin URL, URL fuera de contrato, múltiples
referencias, public_id ausente en DEV, ficha no publicada e inventario ambiguo.
Adjuntos son diagnóstico únicamente: no amplían silenciosamente el contrato.
No expone textos, URLs arbitrarias, identificadores Meta, tokens ni claves.

Pruebas locales 97/97 PASS. Adaptador DEV versión 7 ACTIVE, JWT obligatorio.
Sender OFF. Sin cambios de propiedades/RLS/secretos, merge ni Producción.
