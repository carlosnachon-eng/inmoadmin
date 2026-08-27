import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path,import.meta.url),"utf8");
const migration = await read("../supabase/migrations/202608270002_condominium_owner_portal.sql");
const portal = await read("../pages/condomino.js");
const controlledPortal = await read("../components/condomino/ControlledCondominoPortal.js");
const legacyPortal = await read("../components/condomino/LegacyCondominoPortal.js");
const rlsTests = await read("../supabase/dev/tests/202608270002_condominium_owner_portal_rls_tests.sql");
const checks = await read("../supabase/production/tests/202608270002_condominium_owner_portal_checks.sql");
const rollback = await read("../supabase/production/rollback/202608270002_condominium_owner_portal_rollback.sql");

test("migración MVP es aditiva, multiunidad y no crea PII ni usuarios",()=>{
  assert.match(migration,/create table public\.condominium_unit_portal_access/);
  assert.match(migration,/unique \(unidad_id,email_normalized\)/);
  assert.match(migration,/access_kind in \('OWNER','COOWNER','AUTHORIZED_RESIDENT'\)/);
  assert.doesNotMatch(migration,/@gmail|@hotmail|@outlook|insert into auth\.users/i);
});

test("condominio controlado exige relación explícita y legacy conserva fallback",()=>{
  assert.match(migration,/condominium_is_controlled/);
  assert.match(migration,/not public\.condominium_is_controlled/);
  assert.match(migration,/condominium_unit_portal_access/);
  assert.match(migration,/propietario_email/);
  assert.match(rlsTests,/Tecaxco perdió actualización legacy de comprobante/);
  assert.match(rlsTests,/condominio controlado aceptó correo legacy sin relación explícita/);
});

test("snapshot MVP limita datos a histórico Antive, pagos históricos y cuotas corrientes",()=>{
  assert.match(migration,/condominium_owner_portal_snapshot\(p_unidad_id uuid\)/);
  assert.match(migration,/condominium_owner_has_unit\(u\.condominio_id,u\.id\)/);
  assert.match(migration,/'historical'/);
  assert.match(migration,/'historicalPayments'/);
  assert.match(migration,/'currentFees'/);
  assert.doesNotMatch(migration,/'sourceSha256'|'evidenceReference'|'validationNotes'/);
});

test("PR MVP excluye Storage, comprobantes, documentos, gastos y mantenimiento",()=>{
  assert.doesNotMatch(migration,/storage\.|condominium-owner-private|owner_proof|owner_receipt|owner_documents/i);
  assert.doesNotMatch(controlledPortal,/gastos_condominio|maintenance_tickets/i);
  assert.doesNotMatch(controlledPortal,/Mantenimiento|Documentos|Comprobantes|Adjuntar comprobante|supabase\.storage/i);
  assert.match(checks,/el MVP conserva superficies pospuestas/);
});

test("portal separa histórico Antive y administración Emporio y soporta varias unidades",()=>{
  assert.match(controlledPortal,/Saldo administrativo histórico — Antive/);
  assert.match(controlledPortal,/Administración Emporio/);
  assert.match(controlledPortal,/units\.length > 1/);
  assert.match(controlledPortal,/selectedUnitId/);
  assert.doesNotMatch(controlledPortal,/\.limit\(1\)/);
});

test("Tecaxco conserva vista y capacidades completas del portal legacy",()=>{
  assert.match(legacyPortal,/Mis recibos/);
  assert.match(legacyPortal,/Subir comprobante/);
  assert.match(legacyPortal,/Gastos comunes/);
  assert.match(legacyPortal,/Mantenimiento del condominio/);
  assert.match(legacyPortal,/supabase\.storage\.from\("documentos"\)/);
  assert.match(legacyPortal,/propietario_email\.eq/);
  assert.match(portal,/LegacyCondominoPortal/);
});

test("identidad mixta selecciona experiencia sin conceder fallback controlado",()=>{
  assert.match(portal,/modes\.has\("LEGACY"\) && modes\.has\("CONTROLLED"\)/);
  assert.match(portal,/Portal controlado/);
  assert.match(portal,/Portal legacy/);
  assert.match(portal,/allowedUnitIds=\{legacyUnitIds\}/);
  assert.match(migration,/portal_mode text/);
  assert.match(migration,/then 'CONTROLLED' else 'LEGACY'/);
});

test("RLS cierra mutaciones y módulos pospuestos sólo para condominios controlados",()=>{
  assert.match(migration,/drop policy if exists cuotas_hardened_update/);
  assert.match(migration,/drop policy if exists gastos_hardened_select/);
  assert.match(migration,/drop policy if exists maintenance_hardened_select/);
  assert.match(migration,/not public\.condominium_is_controlled\(condominio_id\)/);
  assert.match(rlsTests,/propietario controlado modificó una cuota/);
  assert.match(rlsTests,/propietario controlado leyó gastos/);
  assert.match(rlsTests,/propietario controlado leyó mantenimiento/);
});

test("rollback restaura helper, policies y grants del hardening anterior",()=>{
  assert.match(rollback,/create policy cuotas_hardened_update/);
  assert.match(rollback,/create policy gastos_hardened_select/);
  assert.match(rollback,/create policy maintenance_hardened_select/);
  assert.match(rollback,/create or replace function public\.condominium_owner_has_unit/);
  assert.match(rollback,/grant execute on function public\.condominium_owner_has_unit/);
  assert.match(rollback,/drop function if exists public\.condominium_is_controlled/);
});

test("pruebas DEV cubren multiunidad, mismo tenant, otro tenant, portal apagado y anon",()=>{
  assert.match(rlsTests,/portal\.mixed@example\.invalid/);
  assert.match(rlsTests,/controlled_count<>2/);
  assert.match(rlsTests,/unidad controlada no relacionada/);
  assert.match(rlsTests,/se permitió acceso a otro tenant/);
  assert.match(rlsTests,/portal apagado todavía permitió snapshot controlado/);
  assert.match(rlsTests,/has_function_privilege\('anon'/);
  assert.match(rlsTests,/rollback;/);
});
