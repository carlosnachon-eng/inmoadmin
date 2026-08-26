# Fase 3A — Identity Bridge

## Auditoría del modelo

- `gv_respond_contact_snapshots.mapped_profile_id` identifica al asesor/perfil interno del flujo comercial; no identifica al cliente administrativo.
- Shadow conserva conversación, hash de contacto y mensajes sanitizados, pero antes de este cambio no persistía el `respond_contact_id` opaco necesario para reutilizar identidad.
- La identidad operacional es `public.users.id`: `contracts.tenant_id` y `properties.owner_id` convergen ahí. `clientes` es un prospecto comercial y no es fuente canónica de arrendamiento/administración.
- `contracts` aporta contrato, inmueble, vigencia y rol inquilino; `properties` aporta inmueble y rol propietario. Una persona puede tener varias relaciones.
- Los snapshots existentes eliminan teléfono/email y Shadow usa un hash del ID de Respond, por lo que los históricos no permiten calcular candidatos exactos sin volver a la fuente autorizada. No hay vínculo canónico existente ni es legítimo inferirlo por nombre/fuzzy.

La consulta agregada productiva no pudo ejecutarse desde el entorno local porque Vercel no entrega variables `Sensitive` a `vercel env run`. Por seguridad no se extrajeron secretos. En consecuencia, la cobertura productiva cuantitativa queda como check read-only previo al rollout; no se inventan cifras. Estructuralmente, vínculos canónicos existentes = 0 porque la tabla no existe en `main`.

## Diseño

`respond_contact_id → respond_identity_links(confirmed) → users → contracts/properties`

- El ID opaco de Respond se persiste sólo server-side en la conversación y el bridge; no se duplica nombre/teléfono/email.
- Coincidencia exacta de teléfono mexicano completo puede crear `candidate`. Más de un sujeto produce `conflict`. Ninguna coincidencia produce `no_candidate` en la vista.
- Nombre, email, teléfono parcial y similitud textual están prohibidos para resolver identidad.
- Sólo una revisión administrativa autenticada transforma un candidato en `confirmed`; rechazo/revocación son auditables.
- Auto‑Real sólo dispone de `resolve_contact_identity`, tool read-only de negocio. Devuelve IDs mínimos, roles, contratos vigentes/históricos, propiedades y ambigüedad. Nunca recibe teléfono/email para identificar.
- El ID sólo entra al snapshot/modelo cuando `SHADOW_IDENTITY_BRIDGE_ENABLED=true`; por defecto el bridge puede desplegarse y revisarse sin cambiar el comportamiento de Auto‑Real vigente.
- Con varias propiedades vigentes no se elige una: devuelve `insufficient_property_context`.

## Pagos y mantenimiento

El bridge sólo aporta IDs confiables. Las tools P3 posteriores consultan pago/ticket por contrato/inmueble confirmado. Una interpretación visual puede ser evidencia auxiliar, nunca confirmación bancaria ni diagnóstico técnico. Sin vínculo confirmado, el resultado es `insufficient_identity_context` y revisión humana.

## Seguridad

- RLS habilitado; `anon`/`authenticated` sin acceso directo.
- `service_role`: links `SELECT/INSERT/UPDATE`, sin DELETE/TRUNCATE; audit append-only.
- Confirmación/rechazo vive en endpoint administrativo separado. No forma parte de la allowlist de tools.
- Canal 544519 y provider `respond_admin` son constraints; Ventas no puede generar el vínculo.
- Cero outbound, cero escritura Respond y cero mutación ERP desde Auto‑Real.

## Integración de Fase 3A

Después de mergear Identity Bridge a `main`, rebasar `codex/fase-3a-operational-resolution-readonly-v2` sobre ese main. Conservar `resolve_contact_identity` como primera policy tool; sus filas `contract`/`property` alimentan `resolvedOperationalContext`, y después ejecutar las tools read-only de mantenimiento/pagos/pendientes. No cherry-pickear la migración dos veces.
