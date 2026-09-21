# PR133 — revisión final de instalación, no ejecución

Fecha: 2026-09-21. **NO-GO para instalar hoy**: catálogo productivo y vía operativa de despliegue no verificados con acceso soportado disponible. No hay fallo funcional demostrado y no se reabren certificaciones cerradas.

## Compatibilidad y evidencia

- Código integrado probado: `41b74c9abf919968791f6944d75c295261f0f2a0`.
- `main` remoto: `58bc401c79749bc5140104f304c639b789256c69`, igual a merge-base; candidato cuatro commits adelante, cero detrás, PR133 Draft/open/mergeable. Confirmado con API GitHub y `git ls-remote`.
- La actualización de esta revisión es documental. Antes de publicar se exige diff vacío contra el candidato probado fuera de `docs/`; no rebase ni mezcla de trabajos ajenos.
- `DATABASE_CERTIFICATION_PASS` y `INTEGRATION_DEV_PASS`: cerrados. No repetidos. Ver [README](README.md) y [integración](integration-dev-report.md).
- Preview: **no ejecutado deliberadamente, deployment automático deshabilitado**. No se exige crearlo ni se cuenta como PASS.

## Artefactos exactos, sin alteraciones

1. `supabase/migrations/202609180001_condominium_owner_canonical_identity.sql`
   SHA256 `2baad974fbf2e46564f457de57d784352043f2467f9392b32226bcf3f507590b`.
2. Compañero `202609180001_condominium_owner_canonical_identity_checks.sql`
   SHA256 `d54aa7325b409c16db170586f2aac7cb64ffcc36f59d9a538354eb31b0a4d334`.

Una migración nueva, sin seed/backfill. No es idempotente de instalación: usa ADD COLUMN/CREATE FUNCTION/RENAME sin IF NOT EXISTS. Si aparecen objetos del paquete ya instalados, detenerse y comparar; no reaplicar automáticamente.

## Dependencias exactas derivadas del código

**Estado productivo de todas: NO VERIFICADO EN ESTA REVISIÓN.** La existencia en main o en DEV no prueba instalación productiva. La lectura preparada [production-catalog-readonly.sql](production-catalog-readonly.sql) sólo consulta metadatos; no se ha ejecutado. No es otra migración ni un test funcional.

| Dependencia previa | Condición exigida |
| --- | --- |
| `public.unidades_condominio` | id uuid, condominio_id uuid, activo boolean, propietario_nombre/propietario_telefono text; PK/FK válidas; capacidad ALTER/TRIGGER del operador; identity_owner_version aún ausente |
| `public.condominios` | id uuid único/PK y activo boolean; referencia válida de unidades |
| `public.profiles` | id uuid, active boolean, role_id text; actor activo/admin existente se verifica al operar, no se crea en instalación |
| `client_identities` | id/status/phone_digest/revoked_at/auth_user_id y defaults de id/timestamps; RLS/ACL existentes |
| `client_identity_roles` | client_identity_id/role_kind/status, PK (client_identity_id,role_kind), defaults/constraints existentes |
| `client_source_links` | id/client_identity_id/source_type/source_id/role_kind/link_status/match_method/confirmed_by/confirmed_at/revoked_at/updated_at; UNIQUE(source_type,source_id); constraint nominal source_type y valores previos de Rentas |
| `client_reconciliation_candidates` | id/candidate_key/role_kind/phone_digest/candidate_status/reason_code/source_count/client_identity_id/reviewed_by/reviewed_at/updated_at; candidate_key único; defaults; nuevas columnas aún ausentes |
| `client_reconciliation_candidate_sources` | candidate_id/source_type/source_id/matched_property_id; constraint nominal source_type y UNIQUE(source_type,source_id); columnas condominales aún ausentes |
| `client_identity_audit` | candidate_id/client_identity_id/event_type/actor_profile_id/context_ids y defaults; eventos candidate_prepared/confirmed/rejected/revoked admitidos |
| `respond_identity_links` | id/respond_contact_id/client_identity_id/link_status/link_source/confidence/reason_code/confirmed_by/confirmed_at/reviewed_by/reviewed_at/revoked_at/updated_at; inmoadmin_client_id nullable; checks e índices únicos actuales preservados |
| `respond_identity_audit` | link_id/respond_contact_id/event_type/actor_profile_id/context_ids y defaults; confirmed/revoked admitidos |
| Funciones Rentas previas | confirm_client_reconciliation_candidate(uuid,uuid,uuid)→uuid y review_client_reconciliation_candidate(uuid,uuid,text)→text; firmas, defaults, owner/ACL/SECURITY DEFINER y cuerpos compatibles con main; nuevos nombres core *_rental_client_candidate_v1 ausentes |
| Crypto y roles SQL | extensions.digest(text,text), pg_catalog.hashtextextended(text,bigint), gen_random_uuid(); anon/authenticated/service_role; permisos del owner para alterar y revocar/conceder exactamente lo certificado |
| Histórica 7/7 | wrapper/core confirm_exact_phone_respond_identity_link y *_core de firma (text,uuid,text,text,timestamptz,text,text,uuid); índices confirmed_identity y auditoría existentes. Conservar hashes/ACL antes/después; no modificados por esta migración |

Procedencia versionada: Condominios/fundación y perfiles existentes; bridge `202608250004_fase_3a_respond_identity_bridge`; modelo `202608260002_fase_3a_canonical_client_model`; operación certificada `202609090001_exact_phone_respond_identity_confirmation_7of7`. Si falta un objeto, **no aplicar estas migraciones como parche**: reportar la dependencia y detener el rollout.

Además revisar constraints/índices/triggers/RLS/defaults y owner/ACL del catálogo contra las definiciones versionadas. No basta comprobar nombres. La consulta no lee teléfonos, nombres, contactos, candidatos ni filas de negocio.

## Gates que deben estar OFF antes y después

| Gate exacto | Por qué |
| --- | --- |
| `SHADOW_CLIENT_RECONCILIATION_PREPARE_ENABLED=false` | Impide preparar candidatos, incluidos condominales |
| `SHADOW_CLIENT_RECONCILIATION_WRITE_ENABLED=false` | Impide escritura/revisión de reconciliación, también rutas legacy |
| `SHADOW_IDENTITY_CONFIRMATION_ENABLED=false` | Impide revisión condominal junto al anterior y confirmación histórica 7/7 |
| `SHADOW_ADMIN_OUTBOUND_ENABLED=false` | Sin sender Admin |
| `SHADOW_OUTBOUND_ENABLED=false` | Sin outbound global |
| `SHADOW_ADMIN_WORK_R1_ENABLED=false` | Sin R1 |
| `SHADOW_ADMIN_OUTBOUND_CANARY_ENABLED=false` | Sin canary Admin; no abrir/rearmar canary durable |

No se introduce un supuesto gate nuevo ni se cambia otro flag. La capacidad prepare depende sólo del primero; review exige WRITE y IDENTITY_CONFIRMATION. Apagar exclusivamente confirmación no basta para cerrar prepare. Gates son server-side de aplicación: la RPC instalada permanece ejecutable por service_role y valida admin/evidencia; no debe invocarse directamente para eludir gates. El esquema no consulta variables Vercel.

**Estado runtime productivo: pendiente de evidencia soportada actual**, no presentado como verificado por esta revisión. Si cualquier gate ya está ON, detenerse; esta autorización no permite cambiarlo. La exclusión Vercel se mantiene sólo para esta rama y no afecta main ni crons.

## Locks e impacto

La transacción ALTER TABLE adquiere ACCESS EXCLUSIVE en `unidades_condominio`, `client_source_links`, `client_reconciliation_candidate_sources`, `client_reconciliation_candidates` y `respond_identity_links`. Pueden bloquear lecturas/escrituras hasta COMMIT/ROLLBACK. Las nuevas FK también requieren locks sobre `condominios`; los CHECK validados pueden escanear filas. El default constante de versión puede evitar rewrite en PostgreSQL moderno, pero no elimina locks ni garantiza duración corta. Consultar versión/tamaños/locks por catálogo y elegir ventana de bajo tráfico; no cancelar sesiones ajenas. [ALTER TABLE oficial](https://www.postgresql.org/docs/17/sql-altertable.html), [locks oficiales](https://www.postgresql.org/docs/17/explicit-locking.html).

No se han medido locks/tamaño productivos. El archivo no fija timeouts: la ejecución futura debe usar una sesión soportada con presupuesto acotado (propuesta: lock_timeout 5 s, statement_timeout 120 s, detención al primer error), sin ajustes globales ni alterar el archivo certificado. Si ese presupuesto no alcanza, detener y revisar; no ampliar automáticamente ni ejecutar en bucle.

Distinto del lock de instalación: cuando la RPC se use en una autorización futura, toma locks advisory por Respond/unidad/identidad, SHARE de unidades/condominios y SHARE ROW EXCLUSIVE de identidades; puede demorar DML concurrente y revalida frescura tras esperar. Con gates OFF y sin invocaciones, instalar la función no ejecuta esos locks operativos.

## Procedimiento futuro, sujeto a precondiciones y autorización posterior

1. Acceso soportado al proyecto productivo **bnzrnizrmonjxlktbhlp**, identidad visible de proyecto verificada fuera de SQL (current_database=postgres no identifica proyecto). Leer catálogo preparado, verificar objetos ausentes/nuevos, firmas/ACL existentes, espacio/locks y permisos sin elevarlos. Confirmar gates OFF mediante metadatos no secretos/runtime administrativo soportado.
2. Confirmar mismo candidato/árbol funcional, hashes de migración/checks y main vigente. Comprobar acceso a SQL Editor oficial o conexión PostgreSQL oficial autorizada y a Vercel para READY/rollback. Si falta, no pedir autorización de ejecución como si estuviese listo.
3. Aplicar **únicamente** el archivo certificado en su transacción, con fail-fast y presupuesto acotado. No db push, otras migraciones, fixtures, backfill, preparar o confirmar personas. Si falla antes del COMMIT, ROLLBACK; no reintentar sin diagnóstico. Un corte de conexión de resultado incierto se resuelve leyendo catálogo, no reaplicando.
4. Tras COMMIT ejecutar inmediatamente el `_checks.sql` exacto read-only. Conservar resultado visible y metadatos de funciones/ACL; comparar hashes históricos 7/7. No repetir certificaciones DEV ni conductuales productivas. Si falla, no hacer merge/deploy y conservar evidencia; no rollback destructivo automático.
5. Sólo con PASS de checks y gates OFF, autorización vigente: Ready + squash merge del HEAD documental aprobado, deployment únicamente desde main. La rama sigue excluida de Preview. No cambiar variables ni crear deployment para obtener un check de PR.
6. Exigir deployment productivo READY y SHA de main correcto. Postcheck exclusivamente read-only: HTTP 200 de `/coordinador-ia-sombra`, sesión/admin según autorización normal, UI nueva con prepare/review deshabilitados; sin pulsar acciones. Usar superficie runtime ya existente para flags, logs/metadatos sin PII, sin errores nuevos de esquema y sin confirmar ni generar tráfico. Preservar tool_results server-side.
7. Cerrar instalación de soporte y detenerse. Preparar candidatos/confirmar personas requiere autorización posterior separada; nada de backfill ni activación implícita.

## Reversión no destructiva

- Antes de COMMIT: ROLLBACK transaccional, incluido error/timeout.
- Después de COMMIT y antes de confirmar personas: si la aplicación falla, volver a un deployment main previo conocido mediante mecanismo oficial Vercel, manteniendo los mismos gates OFF. Preservar esquema aditivo y wrappers protectores; no eliminar columnas, auditoría, fuentes ni bajar discriminadores.
- Después de relaciones legítimas, rollback de aplicación **no es** reversión semántica. Conservar todos los registros. Una revocación necesita una operación administrativa explícita/auditada y autorización separada; no se ejecuta ni se propone borrar evidencia.
- La reversión de esquema no está aprobada/preparada como destructiva. Si se requiriera, revisión específica; nunca DROP CASCADE ni restauración de datos global.

## Acceso y conclusión pendiente exacta

En esta sesión el descubrimiento de tools/recursos no ofreció Supabase/PostgreSQL ni Vercel, y `command -v gh vercel supabase psql` no halló esos CLIs. Git/GitHub sí permiten lectura/publicación de evidencia. No existe conexión productiva autorizada disponible en memoria; el acceso anterior era DEV y se descartó. No se leyó configuración privada para buscar credenciales ni se reintentó automatización de navegador bloqueada.

Falta: **vía autenticada soportada de lectura de catálogo de bnzrnizrmonjxlktbhlp y verificación del operador de instalación; acceso soportado a metadatos Vercel del proyecto inmoadmin/team carlosnachon-engs-projects para deployments, runtime/gates y ruta de rollback**. Un operador autorizado puede proporcionar resultados sanitizados del catálogo y metadatos oficiales; no se solicitan secretos por chat ni se amplían permisos.

No pudo ejecutarse una consulta directa de deployments Vercel. Por tanto no se afirma cero deployments de rama/HEAD ni disponibilidad actual de promoción/rollback. GitHub mergeable o cero checks no prueban eso. Preview sigue omitido deliberadamente; su check verde no es requisito añadido.

**Dictamen único: NO-GO para instalar por precondiciones operativas no verificadas; certificaciones DEV cerradas y válidas.** No merge, instalación, deployment, backfill, personas reales, flags ni monitor ejecutados en esta revisión.
