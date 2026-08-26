# Fase 3A — resolución operativa read-only

## Auditoría previa

Auto-Real usa una allowlist cerrada de once herramientas: `resolve_contact_identity`, `find_properties`,
`find_active_contracts`, `get_payment_summary`, `get_service_period_status`,
`get_maintenance_ticket_summary`, `get_work_center_case`,
`get_key_custody_status`, `get_owner_liquidation_summary`,
`get_policy_or_signature_case` y `get_condominium_fee_summary`.

Las tools ejecutan exclusivamente `select` limitados a cinco resultados. No hay
RPC, insert, update, delete, upsert, envío a Respond ni escritura ERP en el
carril Shadow. Cada ejecución conserva nombre, argumentos validados, propósito,
source (`policy_required`, `model_proposed` o `both`), duración, éxito y cantidad
de resultados. Los hechos críticos se convierten en un evidence ledger.

El último caso real multimedia registró una sola tool read-only. La auditoría
sanitizada confirmó que fue originada dentro de la combinación
policy/modelo del dominio mantenimiento y no produjo writes. El registro actual
de `tool_summary` permite atribuir nombre/source/argumentos sin exponer el
resultado; la revisión de Producción debe usar ese registro, no inferirlo desde
el texto o la imagen.

## Identidad canónica

`resolve_contact_identity` recibe únicamente el `respond_contact_id` opaco que
el servidor persistió. Sólo un `respond_identity_link` confirmado resuelve un
`client_identity_id`; desde ahí obtiene roles, contratos y propiedades ligados
por el Canonical Client Model. No usa `public.users`, teléfono, nombre, email,
texto libre ni fuzzy matching.

Un candidato, conflicto, vínculo revocado o ausencia termina en
`insufficient_identity_context`. Si la identidad está confirmada pero existen
varios inmuebles posibles y el turno no aporta un ID confiable, termina en
`insufficient_property_context`; nunca elige uno arbitrariamente.

## Arquitectura

1. El turn builder conserva conversación y multimedia sanitizadas.
2. Policy engine deriva sólo tools read-only cuando existe un identificador.
3. State machine ejecuta tools allowlisted e incorpora evidence ledger.
4. Grounding bloquea hechos críticos no sustentados.
5. `operationalResolution.js` deriva de forma determinística una propuesta
   operativa; el modelo no decide si una acción se ejecuta.
6. La decisión persiste `operational_resolution` y la telemetría guarda métricas
   agregables, sin tabla nueva.

## Dominios

- Maintenance: ticket existente, posible duplicado, estado, prioridad,
  categoría, responsable técnico por ID, fechas y pendiente.
- Payment: obligación/pago, monto, periodo, estado y comparación aparente con
  una interpretación visual completed. El máximo resultado positivo es
  `pending_bank_confirmation`; nunca confirma pago.
- Administrative pending: context key, estado, prioridad, bucket, responsable,
  autorización y última actuación.

## Contrato de salida

`operational_resolution` contiene `case_domain`, `case_status`,
`identified_entities`, `evidence`, `proposed_action`, `action_confidence`,
`requires_human`, `human_reason`, `missing_information`,
`would_resolve_without_human`, razón de candidatura, estado de identidad,
conflicto y error técnico.

`would_resolve_without_human=true` es sólo una métrica. No activa endpoint,
worker, Respond ni mutación ERP.

## Automation Candidate Rate

La telemetría por run conserva dominio, candidatura, revisión humana, falta de
identidad, falta de información, conflicto y error técnico. La tasa por dominio
se calcula como candidatos / casos observados. No requiere migración ni cambio
del dashboard productivo.

## Rollout

La implementación se valida primero en Preview/DEV con todas las capacidades de
outbound y escritura apagadas. Producción no se modifica sin autorización
separada.
