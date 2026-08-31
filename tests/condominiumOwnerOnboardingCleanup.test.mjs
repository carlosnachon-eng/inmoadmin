import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/202608310002_condominium_owner_onboarding_cleanup.sql");
const rollback = await read("../supabase/production/rollback/202608310002_condominium_owner_onboarding_cleanup_rollback.sql");
const checks = await read("../supabase/production/tests/202608310002_condominium_owner_onboarding_cleanup_checks.sql");
const endpoint = await read("../pages/api/condominios/portal-access.js");

test("cleanup es SECURITY DEFINER, usa search_path fijo y no usa SQL dinámico", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path=public,auth,pg_temp/);
  assert.doesNotMatch(migration, /\bexecute\b\s+(?:format|\()/i);
  assert.match(migration, /public\.cleanup_condominium_owner_onboarding_profile/);
});

test("sólo service_role puede ejecutar y no se amplía DELETE general", () => {
  assert.match(migration, /revoke all on function[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant\s+delete\s+on\s+(?:table\s+)?public\.profiles/i);
  assert.match(checks, /has_table_privilege\('service_role','public\.profiles','DELETE'\)/);
});

test("cleanup exige marcador exacto del intento y perfil propietario externo", () => {
  assert.match(migration, /identity_type',''\)<>\'condominium_owner\'/);
  assert.match(migration, /onboarding_attempt_id',''\)<>p_onboarding_attempt_id::text/);
  assert.match(migration, /rol_pretendido',''\)<>\'propietario\'/);
  assert.match(migration, /v_profile\.role_id<>\'propietario\'/);
  assert.match(migration, /r\.es_externo=true/);
});

test("cleanup bloquea actividad, permisos y cualquier acceso existente", () => {
  assert.match(migration, /last_sign_in_at is not null/);
  assert.match(migration, /auth\.sessions/);
  assert.match(migration, /auth\.refresh_tokens/);
  assert.match(migration, /INTERNAL_PERMISSIONS_PRESENT/);
  assert.match(migration, /PARTNER_ACCESS_PRESENT/);
  assert.match(migration, /MEMBERSHIP_PRESENT/);
  assert.match(migration, /PORTAL_ACCESS_PRESENT/);
  assert.match(migration, /LEGACY_ACCESS_PRESENT/);
});

test("cleanup elimina sólo el perfil exacto y registra auditoría sin PII", () => {
  assert.match(migration, /delete from public\.profiles where id=p_auth_user_id/);
  assert.doesNotMatch(migration, /delete from auth\.users/);
  assert.match(migration, /condominium_owner_onboarding_cleanup_audit/);
  const auditDefinition = migration.match(/create table public\.condominium_owner_onboarding_cleanup_audit \([\s\S]*?\n\);/)?.[0] || "";
  assert.doesNotMatch(auditDefinition, /\bemail\b|full_name|token/i);
  assert.match(migration, /PROFILE_ALREADY_ABSENT/);
  assert.match(migration, /ALREADY_COMPLETE/);
});

test("endpoint borra Auth únicamente después de cleanup autorizado y nunca una identidad preexistente", () => {
  const rpcIndex = endpoint.indexOf('"cleanup_condominium_owner_onboarding_profile"');
  const authDeleteIndex = endpoint.indexOf("auth.admin.deleteUser(authUserId)");
  assert.ok(rpcIndex >= 0 && authDeleteIndex > rpcIndex);
  assert.match(endpoint, /if \(createdNow && authUser\?\.id\)/);
  assert.match(endpoint, /\["PROFILE_DELETED", "PROFILE_ALREADY_ABSENT", "ALREADY_COMPLETE"\]/);
});

test("aun sin perfil, cualquier acceso existente bloquea borrar Auth", () => {
  const profileAbsent = migration.lastIndexOf("v_profile.id is null");
  assert.ok(migration.indexOf("PARTNER_ACCESS_PRESENT") < profileAbsent);
  assert.ok(migration.indexOf("MEMBERSHIP_PRESENT") < profileAbsent);
  assert.ok(migration.indexOf("PORTAL_ACCESS_PRESENT") < profileAbsent);
  assert.ok(migration.indexOf("LEGACY_ACCESS_PRESENT") < profileAbsent);
});

test("rollback preserva auditoría y elimina exclusivamente objetos nuevos", () => {
  assert.match(rollback, /exists\(select 1 from public\.condominium_owner_onboarding_cleanup_audit\)/);
  assert.match(rollback, /Rollback bloqueado/);
  assert.match(rollback, /drop function if exists public\.cleanup_condominium_owner_onboarding_profile/);
  assert.match(rollback, /drop table if exists public\.condominium_owner_onboarding_cleanup_audit/);
  assert.doesNotMatch(rollback, /drop table[^;]*profiles/i);
});
