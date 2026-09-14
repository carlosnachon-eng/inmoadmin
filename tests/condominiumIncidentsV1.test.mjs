import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/202609100001_condominium_incidents_v1.sql");
const rollback=read("supabase/production/rollback/202609100001_condominium_incidents_v1_rollback.sql");
const endpoint=read("pages/api/condominios/incidents.js");
const resident=read("components/condomino/IncidentPanel.js");
const admin=read("components/condominios/AdminIncidentPanel.js");
const legacy=read("pages/mantenimiento.js");
const sqlE2e=read("supabase/dev/tests/202609100002_condominium_incidents_v1_e2e.sql");
const devFingerprint=read("supabase/dev/tests/202609100003_condominium_incidents_v1_fingerprint.sql");
const adminControls=read("supabase/migrations/202609100002_condominium_incidents_v1_admin_controls.sql");
const adminControlsSql=read("supabase/dev/tests/202609100004_condominium_incidents_v1_admin_controls_tests.sql");
const adminControlsPostcheck=read("supabase/production/tests/202609100002_condominium_incidents_v1_admin_controls_checks.sql");
const rollbackCertification=read("supabase/dev/tests/202609100005_condominium_incidents_v1_rollback_certification.sql");

test("Incidencias V1 evoluciona maintenance_tickets sin proveedor ni sistema paralelo",()=>{
 assert.match(migration,/alter table public\.maintenance_tickets/);
 assert.doesNotMatch(migration,/provider_id|create table public\.(?:incidents|tickets_v1)/i);
 for(const name of ["maintenance_ticket_updates","maintenance_ticket_evidence","maintenance_categories"]) assert.match(migration,new RegExp(`create table public\\.${name}`));
});
test("modelo preserva legacy y añade frontera unidad, identidad, idempotencia y auditoría",()=>{
 for(const value of ["unidad_id","reporter_profile_id","responsible_profile_id","idempotency_key","incident_origin","resolution_summary","first_attended_at","resolved_at","closed_at","reopened_at","legacy_record"]) assert.match(migration,new RegExp(value));
 assert.match(migration,/legacy_record boolean not null default true/);
 assert.match(migration,/organization\/administrator -> condominium -> unit/);
});
test("taxonomía corrige abierto/resuelto y conserva estados legacy",()=>{
 for(const status of ["nuevo","revisado","en_proceso","en_espera","terminado","cerrado","cancelado","cotizado","aprobado"]) assert.match(migration,new RegExp(`'${status}'`));
 const condo=read("pages/condominio/[id].js"); assert.doesNotMatch(condo,/<option value="(?:abierto|resuelto)">/);
});
test("RLS fuerza aislamiento, anon sin acceso y V1 no se borra físicamente",()=>{
 assert.match(migration,/maintenance_tickets force row level security/);
 assert.match(migration,/condominium_owner_has_unit\(p_condominio_id,p_unidad_id\)/);
 assert.match(migration,/maintenance_hardened_delete[\s\S]*legacy_record/);
 assert.doesNotMatch(endpoint,/\.from\(["']maintenance_tickets["']\)\.delete/);
 assert.match(migration,/revoke all on public\.maintenance_categories,public\.maintenance_ticket_updates,public\.maintenance_ticket_evidence from public,anon,authenticated/);
});
test("endpoint valida sesión, rol, tenant y usa service role sólo server-side",()=>{
 assert.match(endpoint,/serviceDb\.auth\.getUser\(token\)/);
 assert.match(endpoint,/internalPermission/);
 assert.match(endpoint,/\.eq\("condominio_id", condominioId\)/);
 assert.match(endpoint,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(resident,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
 assert.doesNotMatch(admin,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
});
test("portal residente usa la sesión vigente y conserva errores controlados",()=>{
 assert.match(resident,/supabase\.auth\.getSession\(\)/);
 assert.doesNotMatch(resident,/Authorization:`Bearer \$\{session\.access_token\}`/);
 for(const status of ["status===401","status===403","role=\"alert\""]) assert.match(resident,new RegExp(status));
 assert.match(resident,/setLoadError\(safeError\(result\)\)/);
});
test("Storage es privado, firmado y limitado",()=>{
 assert.match(migration,/values\('condominium-incident-evidence','condominium-incident-evidence',false,5242880,array\['image\/jpeg','image\/png','image\/webp'\]\)/);
 assert.match(endpoint,/createSignedUrl\(row\.storage_path, 60\)/);
 assert.match(endpoint,/sha256/);
 assert.doesNotMatch(endpoint,/getPublicUrl/);
});
test("residente y administración exponen sólo V1 previsto",()=>{
 for(const text of ["Reportar incidencia","Abiertas","Cerradas","JPEG, PNG o WebP"]) assert.match(resident,new RegExp(text));
 for(const text of ["Todas las unidades","Todos los estados","Visible al residente","Nota interna","Timeline"]) assert.match(admin,new RegExp(text));
});
test("administración controla prioridad y responsable con validación server-side",()=>{
 for(const text of ["Prioridad","Responsable","Sin responsable"]) assert.match(admin,new RegExp(text));
 assert.match(admin,/disabled=\{!canEdit\}/);
 assert.match(endpoint,/action === "assignees"/);
 assert.match(endpoint,/roles:role_id!inner\(es_externo\)/);
 assert.match(endpoint,/partner_users/);
 assert.match(endpoint,/p_responsible_change: responsibleChanged/);
 for(const token of ["INVALID_PRIORITY","INVALID_RESPONSIBLE","Prioridad actualizada","Responsable actualizado","Responsable retirado"]) assert.match(adminControls,new RegExp(token));
 assert.match(adminControls,/p\.active=true and r\.es_externo=false/);
 assert.match(adminControls,/revoke execute on function public\.condominium_update_incident_v1[\s\S]*from authenticated/);
 for(const token of ["ADMIN_CONTROLS_VALID_UPDATE_FAILED","ADMIN_CONTROLS_AUDIT_FAILED","ADMIN_CONTROLS_UNASSIGN_FAILED","INVALID_PRIORITY_ALLOWED","MISSING_RESPONSIBLE_ALLOWED","INACTIVE_RESPONSIBLE_ALLOWED","EXTERNAL_RESPONSIBLE_ALLOWED","PARTNER_RESPONSIBLE_ALLOWED","EXTERNAL_UPDATE_ALLOWED","CONDOMINIUM_INCIDENTS_V1_ADMIN_CONTROLS_TESTS_OK"]) assert.match(adminControlsSql,new RegExp(token));
 assert.match(adminControlsSql,/rollback;/);
 assert.match(adminControlsPostcheck,/CONDOMINIUM_INCIDENTS_V1_ADMIN_CONTROLS_POSTCHECK_OK/);
 assert.match(adminControlsPostcheck,/INCIDENT_ADMIN_CONTROLS_LEGACY_RPC_EXPOSED/);
});
test("rollback aborta si existe actividad V1 y legacy permanece sin cambios",()=>{
 assert.match(rollback,/ROLLBACK_ABORTED_INCIDENT_V1_ACTIVITY_EXISTS/);
 assert.doesNotMatch(rollback,/delete from public\.maintenance_tickets/i);
 assert.match(rollback,/drop policy if exists maintenance_hardened_select[\s\S]*drop column legacy_record/);
 assert.match(rollback,/maintenance_tickets_status_check check\(status=any\(array\['nuevo','revisado','cotizado','aprobado','en_proceso','terminado','cerrado','cancelado'\]\)\)/);
 assert.match(rollback,/no force row level security/);
 assert.match(rollback,/maintenance_hardened_insert no es reemplazada por V1/);
 for(const token of ["ROLLBACK_STATUS_CONSTRAINT_MISMATCH","ROLLBACK_RLS_MISMATCH","ROLLBACK_V1_COLUMN_RESIDUE","ROLLBACK_V1_TABLE_RESIDUE","ROLLBACK_V1_RPC_RESIDUE","ROLLBACK_V1_STORAGE_RESIDUE","ROLLBACK_GRANT_MISMATCH","ROLLBACK_POLICY_MISMATCH","CONDOMINIUM_INCIDENTS_V1_ROLLBACK_CERTIFIED"]) assert.match(rollbackCertification,new RegExp(token));
 assert.match(legacy,/maintenance_tickets/);
});
test("DEV cubre residente, administración, timeline, reapertura y aislamiento",()=>{
 for(const token of ["OWNER_CREATE_FAILED","CROSS_CONDO_CREATE_ALLOWED","V1_DELETE_ALLOWED","ADMIN_REVIEW_FAILED","INTERNAL_TIMELINE_FAILED","REOPEN_AUDIT_FAILED","CONDOMINIUM_INCIDENTS_V1_E2E_OK"]) assert.match(sqlE2e,new RegExp(token));
 assert.match(sqlE2e,/rollback;/);
 assert.doesNotMatch(sqlE2e,/G[eé]nova|Tecaxco|@hotmail|@gmail/i);
 assert.match(sqlE2e,/incidents_v1_legacy_baseline/);
 assert.match(sqlE2e,/DEV_LEGACY_FINGERPRINT_CHANGED/);
 assert.match(sqlE2e,/CONDOMINIUM_INCIDENTS_V1_DEV_POSTCHECK_OK/);
 assert.match(devFingerprint,/legacy_ticket_fingerprint/);
 assert.match(devFingerprint,/order by t\.id::text/);
 assert.doesNotMatch(devFingerprint,/nombre|email|telefono|description|title/i);
});
