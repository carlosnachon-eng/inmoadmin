# I2A.0 — invitaciones Partner seguras

Base: `5b45dd1689d2093221a8b64e1d49a83115e783ca`.
Flag: `NEXT_PUBLIC_BLINDAJE_PARTNER_INVITATIONS_ENABLED=false` por defecto. Activación sólo en Preview DEV para revisión; ninguna activación productiva.

## Credencial y permisos

El servidor genera 32 bytes aleatorios (256 bits) con `crypto.randomBytes`, codifica base64url (43 caracteres) y persiste únicamente SHA-256 hexadecimal. El token se devuelve una sola vez al generarlo; no se consulta posteriormente en texto plano. Vigencia explícita de 30 días, elegida para DEV; cambiar `INVITATION_DAYS` afecta únicamente nuevas invitaciones. No hay rotación ni generación automática.

La tabla `blindaje_partner_invitations` contiene los campos pedidos y `linked_record_id`, que impide cambiar de registro al reintentar un enlace ya aceptado. Incluye PK, FKs a agencia/operación/creador, CHECK de rol/hash y UNIQUE de hash; índices por operación, agencia, caducidad y creador. RLS habilitado, cero policies, grants revocados para PUBLIC/anon/authenticated. Sólo service_role accede desde servidor. El aviso de advisors «RLS enabled but no policies» es intencional: no se abre acceso de navegador.

## Endpoints

- `POST /api/partners/invitations`: Bearer validado con Auth getUser; partner_user y agencia activos; operación de esa agencia y rol permitido. Devuelve `{token, role, expires_at}`.
- `DELETE /api/partners/invitations`: misma autorización, body `{operation_id, role}`. Revoca todas las invitaciones no revocadas del rol/operación/agencia. No toca ligas legacy.
- `POST /api/partners/invitation-public`: body `{token}`. Reválida hash, vigencia, revocación, operación, pertenencia y agencia. Inválido/expirado/revocado responden el mismo 404. Sin UUIDs ni datos administrativos.
- `POST /api/partners/link-submission-invited`: body `{token, tipo, record_id}`. Revalida y ejecuta transacción de enlace. No acepta agency/operation IDs del navegador como autoridad.

Todos: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, body máximo 4 KB, errores sanitizados. Flag OFF responde 404 antes de acceder a datos. Falta de service key falla cerrado; nunca usa anon como fallback.

Respuesta pública exacta (valores ilustrativos):

```json
{
  "valid": true,
  "role": "inquilino",
  "agency": {"nombre_comercial": "I2A Agencia", "logo_url": null, "brand_color": "#123456"},
  "operation": {"direccion_inmueble": "I2A Inmueble", "monto_renta": 15000, "nombre_propietario": "I2A Propietario", "nombre_inquilino": "I2A Inquilino"}
}
```

## Enlace transaccional

`blindaje_link_invited_submission(text,text,uuid)` es SECURITY INVOKER con search_path vacío y EXECUTE exclusivamente service_role. No es una RPC pública accesible a anon/authenticated.

Bloquea la invitación y serializa brevemente el chequeo/enlace sobre partner_operations para evitar carreras con escrituras concurrentes. Verifica rol, tabla de registro, origen partner, ausencia de enlace a otra operación y ausencia de otro registro ya asociado al mismo rol. El primer enlace exige created_at no nulo, antigüedad máxima 24h y fecha no anterior a creación de invitación menos 5 minutos; la tolerancia de reloj futuro es 5 minutos. Reintento idéntico de un enlace exitoso se acepta mientras la invitación siga vigente, sin retroceder status. No reasigna un registro diferente.

Estos controles no modifican ni endurecen el endpoint legacy; sus permisos y límites preexistentes siguen fuera de alcance. La credencial autoriza el contexto operación/rol, no verifica identidad civil del titular ni constituye validación de pago.

## Formularios y portal

Portal agrega una sección separada para generar por rol, copiar, abrir y revocar explícitamente. Las ligas generadas son `/solicitud-inquilino#invite=...` y `/registro-propietario#invite=...`; el secreto se envía sólo en POST y no en query/Referer. No analytics ni logs nuevos.

Con fragmento invite, se espera validación antes de montar el formulario; nunca se consulta branding ni link-submission legacy aunque haya query IDs. Rol incorrecto/credencial inválida no degrada a legacy/B2C. El contexto interno se marca `secure_partner_invitation`. Contexto válido omite Paso 0, precarga y mantiene branding; posteriores ediciones no se sobrescriben. El payload captura origen partner incluso si el flag informativo I1 está OFF. Fallo de enlace posterior al insert muestra que el registro fue recibido y no solicita reenviarlo.

Sin fragmento se conserva el flujo actual, incluidos participantes adicionales. Con flag OFF se conserva main. No se crean pagos, casos externos, comprobantes, buckets, investigación ni lógica contable. No se toca ModalSolicitud, caja, cobro_investigacion, APIs Partner legacy, lib/partners, #131/#132 ni Producción.

## Verificación

- `node --test tests/partnerInvitations.test.mjs`: 22 PASS (auth/cross-agency/revocación/hash/allowlist/errores/flag).
- `node --test tests/*.test.mjs`: 1263 PASS.
- Builds ON/OFF con I1 ON: PASS. Advertencias de descarga de Google Fonts en entorno local restringido, sin fallo de compilación.
- `scripts/blindaje/verify-invitations.mjs`: 32 ON + 4 OFF, anchos 390/1440, red interceptada y datos sintéticos. Verifica prefills, edición/back, submit invitado, token fuera de URL/Referer, errores uniformes y fallo de enlace sin repetir insert.
- `scripts/blindaje/verify-origen.mjs`: 40 ON + 40 OFF del flag de invitaciones; legacy Partner/participantes, Emporio y B2C.
- `supabase/dev/blindaje_partner_invitations_i2a0_test.sql`: PASS en DEV; fixtures dentro de BEGIN/ROLLBACK, verifica privilegios y transacción real.
- `git diff --check`: PASS.

Los tests de Auth/cross-agency de endpoints usan dobles de datos; las restricciones de enlace/RLS también se ejecutaron contra Postgres DEV real. Los envíos completos en navegador son sintéticos, sin carga documental real en Storage.

Migración aplicada exclusivamente a `hjfwjnejbcpmknvfpdcq`. Rollback explícito en `supabase/rollback/blindaje_partner_invitations_i2a0.sql`; desactivar flag antes de ejecutar. No ejecutar en Producción.
