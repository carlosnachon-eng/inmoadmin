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
test("rollback aborta si existe actividad V1 y legacy permanece sin cambios",()=>{
 assert.match(rollback,/ROLLBACK_ABORTED_INCIDENT_V1_ACTIVITY_EXISTS/);
 assert.doesNotMatch(rollback,/delete from public\.maintenance_tickets/i);
 assert.match(legacy,/maintenance_tickets/);
});
