import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync(new URL("../supabase/migrations/202608210002_fase_2a_shadow_operational_maintenance.sql",import.meta.url),"utf8");
const checks=fs.readFileSync(new URL("../supabase/production/tests/202608210002_fase_2a_shadow_operational_maintenance_checks.sql",import.meta.url),"utf8");
const rollback=fs.readFileSync(new URL("../supabase/production/rollback/202608210002_fase_2a_shadow_operational_maintenance_rollback.sql",import.meta.url),"utf8");

test("migración Production es transaccional, explícita y sin seed/backfill",()=>{
  const executable=migration.replace(/^--.*$/gm,"");
  assert.match(migration,/^-- Production:[\s\S]*\nbegin;/);
  assert.match(migration,/commit;\s*$/);
  assert.match(migration,/Colisión o instalación parcial/);
  assert.doesNotMatch(migration,/\binsert\s+into\s+public\.maintenance_tickets\b[\s\S]*FASE2A|\bupdate\s+public\.maintenance_tickets\s+set\s+maintenance_scope/i);
  assert.doesNotMatch(executable,/\bseed\b|\bfixture\b|\bbackfill\b/i);
});

test("scope conserva legacy NULL y valida managed/external",()=>{
  assert.match(migration,/maintenance_scope is null/);
  assert.match(migration,/maintenance_scope='managed_property' and property_id is not null and external_job_reference is null/);
  assert.match(migration,/maintenance_scope='external_job' and property_id is null and external_job_reference is not null/);
  assert.match(migration,/ref !~\* '\(https\?:\/\/\|@\|\[\+\]\?\[0-9\]/);
});

test("RPCs mantienen atomicidad ERP + outbox e idempotencia",()=>{
  assert.match(migration,/create function public\.create_maintenance_ticket_with_event[\s\S]*insert into public\.maintenance_tickets[\s\S]*insert into public\.inmoadmin_operational_events/);
  assert.match(migration,/create function public\.approve_maintenance_quote_with_event[\s\S]*update public\.maintenance_quotes[\s\S]*update public\.maintenance_tickets[\s\S]*insert into public\.inmoadmin_operational_events/);
  assert.match(migration,/maintenance_ticket_created:'\|\|t\.id/);
  assert.match(migration,/maintenance_quote_approved:'\|\|q\.id/);
  assert.match(migration,/update public\.inmoadmin_operational_events set processed_at=now\(\)[\s\S]*where event_id=e\.event_id/);
});

test("seguridad Production no abre anon/authenticated ni policies",()=>{
  assert.match(migration,/enable row level security/g);
  assert.match(migration,/revoke all on public\.inmoadmin_operational_events, public\.shadow_operational_events from public,anon,authenticated/);
  assert.match(migration,/grant select on public\.shadow_operational_events to authenticated/);
  assert.doesNotMatch(migration,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
  assert.match(checks,/anon conserva privilegios indebidos/);
  assert.match(checks,/authenticated conserva escritura\/outbox indebida/);
  assert.match(checks,/Policy abierta detectada/);
  assert.doesNotMatch(checks,/has_(?:any_)?column_privilege\([^\n]*DELETE/i);
  for(const role of ["anon","authenticated","service_role"]){
    assert.match(checks,new RegExp(`has_table_privilege\\('${role}'`));
  }
  for(const privilege of ["SELECT","INSERT","UPDATE","DELETE"]){
    assert.match(checks,new RegExp(`has_table_privilege\\([^\\n]*'${privilege}'\\)`));
  }
  assert.match(checks,/relrowsecurity/);
  assert.match(checks,/shadow_operational_read_authorized/);
  assert.match(checks,/has_function_privilege/);
  assert.match(checks,/Instalación inicial no está vacía/);
  assert.match(checks,/maintenance_scope is null/);
});

test("carril operacional no modifica Shadow conversacional, Respond ni IA",()=>{
  for(const forbidden of ["shadow_messages","shadow_conversations","respond_admin","544519","SHADOW_AI_ENABLED","shadow_ai_runs","shadow_ai_decisions"]){
    assert.equal(migration.includes(forbidden),false,`${forbidden} no debe estar en DDL operacional`);
  }
  assert.match(migration,/create table public\.shadow_operational_events/);
  assert.doesNotMatch(migration,/create\s+trigger/i);
});

test("rollback exige ownership y se niega si existe auditoría",()=>{
  assert.match(rollback,/Ownership no demostrable; rollback detenido/);
  assert.match(rollback,/exists\(select 1 from public\.inmoadmin_operational_events\)/);
  assert.match(rollback,/exists\(select 1 from public\.shadow_operational_events\)/);
  assert.match(rollback,/shadow_ingestion_events where provider='inmoadmin'/);
  assert.match(rollback,/rollback destructivo rechazado/);
  assert.doesNotMatch(rollback,/cascade/i);
});
