# Evolución multiárea del snapshot Respond.io

`gv_respond_contact_snapshots` representa el estado operativo canónico actual de
cada contacto Respond.io. La recepción, deduplicación, cola, procesamiento y
snapshot no se separan por departamento.

`sales_relevant` se conserva como proyección derivada para Work Center Ventas.
No determina si el snapshot se persiste y no sustituye a
`respond_record_active` ni a `respond_blocked`.

## Clasificación futura

Cuando se diseñen los módulos adicionales, la clasificación debe ocurrir
después de actualizar el snapshot y debe admitir que un contacto pertenezca a
más de un área. La evolución propuesta es una tabla muchos-a-muchos, sin
reemplazar `sales_relevant`:

```text
gv_respond_contact_area_relevance
  snapshot_id
  area_key
  status                  -- relevant, excluded, uncertain
  reason_codes
  classifier_version
  classified_at
  source_snapshot_updated_at
  evidence                -- códigos autorizados, sin PII

primary key (snapshot_id, area_key)
```

La clasificación podrá usar `atn_area`, `atn_servicio`, lifecycle, assignee,
rol/equipo del assignee y otros campos ATN expresamente autorizados. No debe
depender de emails o IDs hardcodeados ni almacenar teléfonos, emails del
contacto, cuerpos de mensajes o attachments.

Esta tabla y las policies de Jurídico, Administración, Propietarios/Dirección o
Condominios quedan fuera de Fase 2A.1-A.

## Pendiente de reconciliación

La reconciliación completa actual actualiza todos los contactos devueltos por
Respond.io, pero todavía no marca como inactivo un snapshot que no haya sido
visto durante un recorrido completo. La reconciliación negativa requiere un
diseño posterior y no forma parte de este corte.
