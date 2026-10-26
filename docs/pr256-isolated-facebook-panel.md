# PR #256 — panel de Comentarios DEV aislado

El panel Facebook del Preview de `codex/comments-observation-approval` utiliza
`facebook-comments-dev-review` en Supabase DEV. No hay fallback a la conexión ni
al token de Messenger. Instagram conserva su adaptador existente.

La función exige JWT, usuario activo Admin/Gerencia y la conexión fija de Emporio
Comentarios DEV. Las claves permanecen en Supabase. Reutiliza los contratos de
cifrado, RPC de revisión, evaluación conservadora y aprobación sin publicación.
Sólo admite listado, evaluación y aprobación. No importa transportes de envío ni
ejecuta capture/claim/dispatch. El diagnóstico de token mantiene su ruta separada.

Validación local: 48/48 pruebas relevantes PASS, build PASS (advertencias de
descarga de fuentes por red). Fixtures de listado poblado/aprobación son locales
y sintéticos: no acreditan un comentario real de Meta. Cubren roles, aislamiento,
sender ON bloqueado, operación no autorizada, binding alterado, revisión obsoleta,
token ausente y proxy restringido a rama/entorno.

Baseline remoto: conexión activa, sender false, 0 eventos, 0 revisiones y 0 acciones.
Sin migraciones, nuevos secretos, cambios de suscripción o escrituras de fixtures
en DEV. La recepción orgánica y evaluación poblada real siguen pendientes.
