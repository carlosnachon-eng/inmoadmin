import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path,import.meta.url),"utf8");
const migration = await read("../supabase/migrations/202608270002_condominium_owner_portal.sql");
const portal = await read("../pages/condomino.js");
const fileApi = await read("../pages/api/condomino/private-file.js");
const server = await read("../lib/condominios/ownerPortalServer.mjs");
const rlsTests = await read("../supabase/dev/tests/202608270002_condominium_owner_portal_rls_tests.sql");

test("migración multiunidad es aditiva, sin PII ni usuarios",()=>{
  assert.match(migration,/create table public\.condominium_unit_portal_access/);
  assert.match(migration,/unique \(unidad_id,email_normalized\)/);
  assert.match(migration,/access_kind in \('OWNER','COOWNER','AUTHORIZED_RESIDENT'\)/);
  assert.match(migration,/or exists\([\s\S]*condominium_unit_portal_access/);
  assert.doesNotMatch(migration,/@gmail|@hotmail|@outlook|insert into auth\.users/i);
});

test("histórico, corriente y documentos salen de un snapshot limitado a la unidad",()=>{
  assert.match(migration,/condominium_owner_portal_snapshot\(p_unidad_id uuid\)/);
  assert.match(migration,/condominium_owner_has_unit\(u\.condominio_id,u\.id\)/);
  assert.match(migration,/'historical'/);
  assert.match(migration,/'historicalPayments'/);
  assert.match(migration,/'currentFees'/);
  assert.match(migration,/'documents'/);
  assert.doesNotMatch(migration,/'sourceSha256'|'evidenceReference'|'validationNotes'/);
  assert.doesNotMatch(migration,/'tickets'|maintenance_tickets/);
  assert.doesNotMatch(portal,/Mantenimiento|snapshot\?\.tickets/);
});

test("gastos se ocultan cuando movimientos de dinero están apagados",()=>{
  assert.match(migration,/select coalesce\(o\.money_movements_enabled,true\) into show_expenses/);
  assert.match(migration,/'expensesVisible',show_expenses/);
  assert.match(migration,/'expenses',case when show_expenses/);
  assert.match(portal,/snapshot\?\.expensesVisible/);
});

test("archivos de propietario usan bucket privado y URLs temporales",()=>{
  assert.match(migration,/'condominium-owner-private','condominium-owner-private',false/);
  assert.match(fileApi,/createSignedUploadUrl/);
  assert.match(fileApi,/createSignedUrl\(path, 60\)/);
  assert.doesNotMatch(portal,/getPublicUrl/);
  assert.doesNotMatch(portal,/comprobante_url|recibo_url/);
  assert.match(server,/OWNER_UPLOAD_EXTENSIONS = new Set\(\["pdf", "jpg", "jpeg", "png", "webp"\]\)/);
  assert.match(server,/OWNER_UPLOAD_EXTENSIONS\.has\(extension\) \? extension : null/);
});

test("endpoint autentica antes de construir service_role y valida alcance por RLS/RPC",()=>{
  assert.ok(fileApi.indexOf("authorizePortalRequest(req)") < fileApi.indexOf("createPortalAdmin()"));
  assert.match(fileApi,/authorization\.scoped[\s\S]*cuotas_condominio/);
  assert.match(fileApi,/condominium_owner_attach_fee_proof/);
  assert.match(fileApi,/condominium_owner_storage_path/);
  assert.doesNotMatch(fileApi,/error\.message/);
});

test("portal separa histórico Antive y administración Emporio y soporta varias unidades",()=>{
  assert.match(portal,/Saldo administrativo histórico — Antive/);
  assert.match(portal,/Administración Emporio/);
  assert.match(portal,/units\.length > 1/);
  assert.match(portal,/selectedUnitId/);
  assert.doesNotMatch(portal,/\.limit\(1\)/);
});

test("escritura directa de rutas queda bloqueada y sólo RPC adjunta comprobantes",()=>{
  assert.match(migration,/condominium_external_fee_update_guard/);
  assert.match(migration,/app\.condominium_owner_proof_rpc/);
  assert.match(migration,/El portal sólo puede adjuntar un comprobante mediante el flujo autorizado/);
  assert.match(migration,/condominium_owner_attach_fee_proof/);
});

test("pruebas DEV cubren multiunidad, mismo tenant, otro tenant, portal apagado, anon y rollback",()=>{
  assert.match(rlsTests,/portal\.multiunit@example\.invalid/);
  assert.match(rlsTests,/authorized_count<>2/);
  assert.match(rlsTests,/unidad no relacionada del mismo condominio/);
  assert.match(rlsTests,/se permitió acceso a otro tenant/);
  assert.match(rlsTests,/portal apagado todavía permitió snapshot/);
  assert.match(rlsTests,/has_function_privilege\('anon'/);
  assert.match(rlsTests,/rollback;/);
});
