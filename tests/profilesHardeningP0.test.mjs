import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../supabase/migrations/202608310003_profiles_hardening_p0.sql");
const checks = await read("../supabase/production/tests/202608310003_profiles_hardening_p0_checks.sql");
const rls = await read("../supabase/dev/tests/202608310003_profiles_hardening_p0_rls_tests.sql");
const authTrigger = await read("../supabase/dev/tests/202608310003_profiles_hardening_p0_auth_trigger_tests.sql");
const postgrest = await read("../scripts/qa/profiles-hardening-postgrest-dev.mjs");
const regressions = await read("../supabase/dev/tests/202608310003_profiles_hardening_p0_regression_checks.sql");
const safeRollback = await read("../supabase/production/rollback/202608310003_profiles_hardening_p0_safe_rollback.sql");
const emergencyRollback = await read("../supabase/production/rollback/202608310003_profiles_hardening_p0_emergency_rollback_NOT_EXECUTABLE.sql");
const partnerApproval = await read("../pages/api/partners/approve.js");
const controlledPortal = await read("../components/condomino/ControlledCondominoPortal.js");
const legacyPortal = await read("../components/condomino/LegacyCondominoPortal.js");
const antive = await read("../pages/antive-transicion.js");

test("la migración falla cerrado para policies y grants fuera de los tres baselines", () => {
  assert.match(migration, /policy desconocida en public\.profiles/);
  assert.match(migration, /v_baseline := 'production'/);
  assert.match(migration, /v_baseline := 'dev'/);
  assert.match(migration, /v_baseline := 'target'/);
  assert.match(migration, /grants productivos fuera del baseline auditado/);
  assert.match(migration, /grants DEV fuera del baseline auditado/);
  assert.match(migration, /grants target fuera del estado certificado/);
});

test("anon queda sin grants; authenticated sólo SELECT; service_role sólo SELECT+UPDATE", () => {
  assert.match(migration, /revoke all on table public\.profiles from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on table public\.profiles to authenticated/);
  assert.match(migration, /grant select, update on table public\.profiles to service_role/);
  assert.doesNotMatch(migration, /grant (?:insert|delete|truncate|references|trigger).*public\.profiles/i);
  assert.match(checks, /authenticated no quedó limitado a SELECT/);
  assert.match(checks, /service_role no quedó limitado a SELECT\+UPDATE/);
});

test("el helper interno es boolean-only, SECURITY DEFINER y no recursivo", () => {
  assert.match(migration, /function public\.profiles_is_active_internal_reader\(\)[\s\S]*returns boolean[\s\S]*security definer[\s\S]*set search_path = public, pg_temp/);
  assert.match(migration, /p\.active=true/);
  assert.match(migration, /coalesce\(r\.es_externo,false\)=false/);
  assert.doesNotMatch(migration, /execute format|return query/);
  assert.match(migration, /revoke all on function public\.profiles_is_active_internal_reader\(\) from public, anon/);
});

test("RLS separa self-select de directorio interno y conserva el gate Phase 0", () => {
  assert.match(migration, /create policy profiles_self_select[\s\S]*using \(id=auth\.uid\(\)\)/);
  assert.match(migration, /create policy profiles_internal_directory_select[\s\S]*profiles_is_active_internal_reader/);
  assert.doesNotMatch(migration, /drop policy if exists p0_inactive_profile_gate/);
  assert.match(rls, /propietario ve % perfiles; esperado 1/);
  assert.match(rls, /Antive ve % perfiles; esperado 1/);
  assert.match(rls, /interno activo perdió directorio operativo/);
  assert.match(rls, /interno inactivo no fue bloqueado por Phase 0/);
});

test("handle_new_user conserva trigger, limita roles y deja de ser RPC", () => {
  assert.match(migration, /function public\.handle_new_user\(\)[\s\S]*security definer[\s\S]*set search_path = public, pg_temp/);
  assert.match(migration, /rol_solicitado in \('propietario','inquilino','condomino'\)/);
  assert.doesNotMatch(migration, /rol_solicitado='antive_transition'/);
  assert.match(migration, /AUTH_PROFILE_ROLE_NOT_ALLOWED/);
  assert.match(migration, /insert into public\.profiles\(id,email,role,role_id\)/);
  assert.match(migration, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.handle_new_user\(\) to supabase_auth_admin/);
  assert.match(checks, /trigger Auth no está activo/);
  assert.match(checks, /supabase_auth_admin no puede ejecutar el trigger Auth/);
  for (const role of ["propietario", "inquilino", "condomino", "asesor", "antive_transition"]) assert.match(authTrigger, new RegExp(role));
  assert.match(authTrigger, /rol privilegiado inesperado fue aceptado/);
  assert.match(authTrigger, /rol externo privilegiado fue aceptado desde metadata/);
  assert.match(authTrigger, /rollback;/);
});

test("Partner conserva UPDATE server-side y portales/Antive usan OTP sin creación libre", () => {
  assert.match(partnerApproval, /from\('profiles'\)[\s\S]{0,120}\.update\(/);
  assert.match(controlledPortal, /shouldCreateUser: false/);
  assert.match(legacyPortal, /shouldCreateUser: false/);
  assert.match(antive, /shouldCreateUser: false/);
});

test("rollback ordinario no reabre el P0 y el exacto aborta siempre", () => {
  assert.doesNotMatch(safeRollback, /allow all profiles|grant .*insert|grant .*delete|grant .*truncate/i);
  assert.match(safeRollback, /policies objetivo no están completas/);
  assert.match(emergencyRollback, /ROLLBACK EXACTO DESHABILITADO/);
  assert.match(emergencyRollback, /deliberadamente comentado/);
});

test("pruebas DEV cubren DML, TRUNCATE, externo, interno, Antive y service_role", () => {
  for (const marker of ["anon SELECT", "anon INSERT", "anon UPDATE", "anon DELETE", "anon TRUNCATE", "propietario UPDATE", "propietario DELETE", "Antive", "interno activo", "interno inactivo", "service INSERT", "service DELETE", "service TRUNCATE"]) {
    assert.match(rls, new RegExp(marker, "i"));
  }
  assert.match(rls, /rollback;/);
});

test("smoke PostgREST usa DEV, OTP sin correo, recovery y limpia Auth", () => {
  assert.match(postgrest, /hjfwjnejbcpmknvfpdcq/);
  assert.match(postgrest, /generateLink/);
  assert.match(postgrest, /verifyOtp/);
  assert.match(postgrest, /type = "magiclink"/);
  assert.match(postgrest, /"recovery"/);
  assert.match(postgrest, /admin\.auth\.admin\.deleteUser/);
  assert.doesNotMatch(postgrest, /bnzrnizrmonjxlktbhlp|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_SECRET/);
});

test("regresión directa conserva Tecaxco, Génova, Antive, histórico y Shadow", () => {
  for (const marker of ["Tecaxco", "segundo tenant", "Génova", "cuentas históricas", "pagos históricos", "recuperaciones", "Antive transición", "RLS Shadow", "policy Shadow abierta"]) {
    assert.match(regressions, new RegExp(marker, "i"));
  }
  assert.match(regressions, /rollback;/);
});
