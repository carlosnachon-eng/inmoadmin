# P0 profiles hardening

Estado: preparado para DEV/Preview. Producción no debe ejecutarse sin una autorización independiente.

## Composición con Access Identity Phase 0

La policy restrictiva `p0_inactive_profile_gate` se conserva. Las policies de
este paquete son permisivas únicamente para `SELECT`: la fila propia o el
directorio para un perfil interno activo. Cuando el gate Phase 0 existe, ambas
capas se componen con `AND`; un perfil inactivo no recupera acceso.

La migración reconoce tres estados: el baseline productivo abierto, el baseline
DEV con `dev_read_authenticated_profiles` + gate Phase 0 y el estado objetivo
idempotente. Cualquier policy o combinación de grants distinta aborta.

## Resultado objetivo

| Rol | Grants de tabla | RLS efectivo |
|---|---|---|
| `anon` | ninguno | ningún acceso |
| `authenticated` externo | `SELECT` | sólo su fila |
| `authenticated` interno activo | `SELECT` | fila propia + directorio interno |
| `authenticated` interno inactivo | `SELECT` | bloqueado por Phase 0; sin directorio |
| `service_role` | `SELECT`, `UPDATE` | sólo uso server-side |

No se concede `INSERT`, `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER` a
clientes. `handle_new_user()` conserva la inserción por trigger como
`SECURITY DEFINER`, fija `search_path` y deja de estar expuesta como RPC.
Su ejecución queda concedida únicamente a `supabase_auth_admin`, dependencia
necesaria confirmada mediante una creación Auth real en DEV.

Los roles externos privilegiados, incluido `antive_transition`, no se aceptan
desde `raw_user_meta_data`: Auth persiste `app_metadata` personalizado después
del INSERT que dispara el trigger. Esos perfiles se asignan posteriormente por
el backend autorizado usando el `UPDATE` server-side conservado.

## Rollback

El rollback operativo seguro sólo restaura el fallback legacy de rol del trigger
si apareciera una regresión Auth. Mantiene RLS y grants endurecidos.

El rollback exacto anterior está documentado en un archivo que aborta siempre.
Su ejecución reabriría el P0 y requiere una autorización de incidente distinta.

## Guardrail de despliegue

Antes de cada prueba Preview se debe confirmar rama, HEAD, target Preview,
project ref DEV, `SUPABASE_ENVIRONMENT=dev`, ausencia de referencia productiva
y ausencia de secretos en bundle/logs.
