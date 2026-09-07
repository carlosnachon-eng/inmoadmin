# Resolución canónica previa a 3B

La resolución usa exclusivamente relaciones estructuradas y confirmadas. El orden es:

1. `shadow_conversations.respond_contact_id` → un único `respond_identity_links` con estado `confirmed`.
2. El vínculo → una `client_identity` activa y un único rol activo (`tenant` u `owner`).
3. `client_source_links` confirmados → contratos del inquilino o propiedades del propietario.
4. Contratos y propiedades se reevalúan a la fecha efectiva del inbound; un snapshot de estado no puede mantener vigente un contrato ya vencido.
5. Si hay una única relación vigente, el resolver entrega el contexto estructurado a 3B. Una referencia textual sólo puede desambiguar dentro de las propiedades ya vinculadas y mediante coincidencia completa de tokens normalizados; nunca descubre una identidad o propiedad nueva.

La salida incluye `canonicalContactId`, `identityConfirmed`, `roles`, `properties`, `contracts`, `relationshipCurrent`, `evidenceLevel`, `evidenceSources` y `failClosedReason`. Los motivos cerrados incluyen vínculo ausente/conflictivo, identidad inactiva, rol ambiguo, propiedad ambigua, propiedad insuficiente y contrato no vigente.

No se modifican umbrales, `requires_human`, sensibilidad financiera, acciones, auto-send, outbound, R1, ERP ni canaries.

## Confirmación `exact_phone_unique`

La promoción es una operación separada del lector normal. Primero vuelve a consultar el contacto actual directamente en Respond, normaliza el teléfono y compara su SHA-256 con el `phone_digest` canónico. El dry-run exige un solo digest activo, un solo contacto Respond compatible, ausencia de vínculos confirmados conflictivos y una única relación vigente de rol, propiedad y contrato a la fecha efectiva. Nombre libre, dirección textual y salida del modelo no participan en la confirmación.

La función SQL `confirm_exact_phone_respond_identity_link` repite todas las guardas dentro de una transacción, bloquea los vínculos vivos del contacto y registra un evento append-only con versión/hash de evidencia e identificadores estructurados. La misma evidencia ya confirmada responde `already_confirmed`; una contradicción registra el motivo y no promueve el vínculo. El RPC sólo se concede a `service_role` y la API conserva la capability de escritura de revisión apagada por defecto.
