# Incidencias V1

Incidencias V1 evoluciona `maintenance_tickets`; no crea un sistema paralelo. Su frontera de autorización temporal es `condominio_id` y cada incidencia moderna exige `unidad_id`. La raíz SaaS futura será `organization/administrator → condominium → unit`; ningún comportamiento depende de Emporio, Génova o Tecaxco por nombre.

Los 47 tickets preexistentes permanecen `legacy_record=true`, sin inferir unidad, identidad, categoría ni evidencia. `/mantenimiento` conserva su operación legacy. Las 14 fotografías públicas existentes quedan como deuda técnica explícita y no se migran en esta intervención.

Las incidencias modernas se crean y actualizan mediante funciones y endpoint validados. No se eliminan físicamente. La evidencia V1 vive en un bucket privado, admite JPEG/PNG/WebP hasta 5 MB y se consulta mediante URL firmada de 60 segundos.

Rollback: sólo es seguro antes de que exista cualquier actividad V1. Si existen incidencias, actualizaciones o evidencias modernas, el rollback aborta para preservar auditoría.
