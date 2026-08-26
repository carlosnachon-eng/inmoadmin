# Fase 3A — Canonical Client Model

## Decisión

`client_identities` es la identidad externa canónica. No sustituye `auth.users` ni crea cuentas de acceso. `auth_user_id` es opcional y sólo permite enlazar posteriormente una identidad con una cuenta existente mediante un flujo separado.

El teléfono completo nunca se guarda en el modelo nuevo. Para descubrimiento se conserva únicamente `phone_digest`, SHA-256 del número mexicano completo normalizado. El digest está protegido por RLS y sólo es consultable server-side; no se expone a navegador, Auto-Real ni reportes.

## Cohorte inicial

- Inquilinos de contratos activos.
- Propietarios de propiedades relacionadas de forma exacta y unívoca con esos contratos.
- Contratos vencidos, prospectos comerciales e históricos quedan fuera.
- La preparación crea candidatos; nunca confirma identidades.

La auditoría previa arrojó 55 contratos activos, 55 relaciones exactas contrato–propiedad, 55 grupos de inquilinos, 28 grupos normalizables de propietarios y 2 registros de propietario con teléfono inválido que requieren revisión. El mínimo estimado es 83 identidades canónicas; las dos inválidas sólo pueden elevarlo a 85 tras revisión humana.

## Modelo y trazabilidad

- `client_identities`: sujeto canónico, estado y vínculo Auth opcional.
- `client_identity_roles`: roles `tenant`/`owner`; una identidad puede tener ambos.
- `client_source_links`: fuentes autorizadas `active_contract_tenant` y `managed_property_owner`.
- `client_reconciliation_candidates` y `_sources`: bandeja administrativa, sin PII duplicada.
- `client_identity_audit`: auditoría append-only con IDs mínimos.
- `contracts.tenant_client_id`, `contracts.property_id` y `properties.owner_client_id`: navegación operativa canónica.

Los campos legacy de nombre, email y teléfono se preservan. No se borran ni se usan como identidad canónica. Nombre/email sólo sirven para detectar contradicciones y forzar `conflict`; nunca para unir personas.

## Reconciliación humana

La UI administrativa prepara la cohorte y permite confirmar, rechazar, marcar conflicto u omitir. Confirmar llama una RPC server-side transaccional que:

1. bloquea el candidato;
2. crea una identidad o reutiliza explícitamente un UUID existente;
3. activa el rol;
4. crea el source link confirmado;
5. puebla las FKs de contrato/propiedad;
6. registra auditoría.

Cualquier fallo revierte toda la operación. No existe confirmación automática ni creación implícita de Auth.

## Identity Bridge y operación

El bridge conserva `respond_contact_id → confirmed link → client_identity_id`. La búsqueda usa únicamente digest exacto y sólo identidades activas con source links confirmados. `candidate`, `conflict`, `revoked` y `skipped` no son utilizables por Auto-Real.

Una identidad confirmada permite devolver contratos activos/históricos, roles y propiedades sin teléfono/email/nombre. Si hay varias propiedades y el turno no aporta una referencia determinística, el resultado es `insufficient_property_context`.

- Pagos: identidad → contrato → obligación read-only → posible coincidencia → `pending_bank_confirmation`. Nunca confirma pago.
- Mantenimiento: identidad → contrato/propiedad → ticket read-only → estado y propuesta. Nunca crea, actualiza ni cierra tickets.

## Seguridad y rollback

RLS está activo en todas las tablas nuevas. `anon` y `authenticated` no tienen acceso directo. `service_role` recibe sólo los grants allowlisted y las RPC administrativas no son ejecutables por cliente. Auto-Real no dispone de las RPC de reconciliación.

El rollback se niega si existe cualquier auditoría, source link confirmado, vínculo Respond canónico o FK poblada, para evitar pérdida de trazabilidad.
