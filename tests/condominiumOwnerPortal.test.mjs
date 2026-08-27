import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path,import.meta.url),"utf8");
const migration = await read("../supabase/migrations/202608270002_condominium_owner_portal.sql");
const portal = await read("../pages/condomino.js");
const rlsTests = await read("../supabase/dev/tests/202608270002_condominium_owner_portal_rls_tests.sql");
const checks = await read("../supabase/production/tests/202608270002_condominium_owner_portal_checks.sql");

test("migración MVP es aditiva, multiunidad y no crea PII ni usuarios",()=>{
  assert.match(migration,/create table public\.condominium_unit_portal_access/);
  assert.match(migration,/unique \(unidad_id,email_normalized\)/);
  assert.match(migration,/access_kind in \('OWNER','COOWNER','AUTHORIZED_RESIDENT'\)/);
  assert.doesNotMatch(migration,/@gmail|@hotmail|@outlook|insert into auth\.users/i);
});

test("condominio controlado exige relación explícita y legacy conserva fallback",()=>{
  assert.match(migration,/exists\(select 1 from public\.condominium_operation_controls/);
  assert.match(migration,/not exists\(select 1 from public\.condominium_operation_controls/);
  assert.match(migration,/condominium_unit_portal_access/);
  assert.match(migration,/propietario_email/);
  assert.match(rlsTests,/se rompió el fallback legacy de Tecaxco/);
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
  assert.doesNotMatch(migration,/storage\.|condominium-owner-private|owner_proof|owner_receipt|owner_documents|gastos_condominio|maintenance_tickets/i);
  assert.doesNotMatch(portal,/Mantenimiento|Documentos|Comprobantes|Adjuntar comprobante|supabase\.storage/i);
  assert.match(checks,/el MVP conserva superficies pospuestas/);
});

test("portal separa histórico Antive y administración Emporio y soporta varias unidades",()=>{
  assert.match(portal,/Saldo administrativo histórico — Antive/);
  assert.match(portal,/Administración Emporio/);
  assert.match(portal,/units\.length > 1/);
  assert.match(portal,/selectedUnitId/);
  assert.doesNotMatch(portal,/\.limit\(1\)/);
});

test("pruebas DEV cubren multiunidad, mismo tenant, otro tenant, portal apagado y anon",()=>{
  assert.match(rlsTests,/portal\.multiunit@example\.invalid/);
  assert.match(rlsTests,/authorized_count<>2/);
  assert.match(rlsTests,/unidad no relacionada del mismo condominio/);
  assert.match(rlsTests,/se permitió acceso a otro tenant/);
  assert.match(rlsTests,/portal apagado todavía permitió snapshot/);
  assert.match(rlsTests,/has_function_privilege\('anon'/);
  assert.match(rlsTests,/rollback;/);
});
