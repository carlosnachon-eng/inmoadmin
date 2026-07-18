import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_ABORT_MESSAGE,
  validateDemoEnvironment,
} from "../../scripts/lib/demo-environment-guard.mjs";

const demoRef = "kmxzvcngfrzcasedtexw";

function jwt(role, ref = demoRef) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, ref, iss: "supabase" })}.signature`;
}

function validEnv() {
  return {
    APP_ENV: "demo",
    SUPABASE_ENVIRONMENT: "demo",
    DEMO_OPERATION_CONFIRMATION: "I_ACKNOWLEDGE_DEMO_ONLY",
    SUPABASE_DEMO_PROJECT_NAME: "inmoadmin-condominios-demo",
    SUPABASE_DEMO_PROJECT_REF: demoRef,
    NEXT_PUBLIC_SUPABASE_DEMO_URL: `https://${demoRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_DEMO_ANON_KEY: jwt("anon"),
    SUPABASE_DEMO_SERVICE_ROLE_KEY: jwt("service_role"),
    SUPABASE_DEMO_DB_URL: `postgresql://postgres:password@db.${demoRef}.supabase.co:5432/postgres`,
    SUPABASE_DEMO_ALLOWED_PROJECT_REFS: demoRef,
    SUPABASE_PRODUCTION_PROJECT_REF_BLOCKLIST: "bnzrnizrmonjxlktbhlp",
    SUPABASE_PRODUCTION_URL_BLOCKLIST: "https://bnzrnizrmonjxlktbhlp.supabase.co",
  };
}

function rejected(env) {
  assert.throws(
    () => validateDemoEnvironment(env, { log: () => {} }),
    (error) => error.message.startsWith(DEMO_ABORT_MESSAGE),
  );
}

test("acepta exclusivamente un destino demo consistente", () => {
  const result = validateDemoEnvironment(validEnv(), { log: () => {} });
  assert.equal(result.projectRef, demoRef);
  assert.equal(result.productionBlocked, true);
});

test("rechaza producción aunque las banderas digan demo", () => {
  const env = validEnv();
  env.SUPABASE_DEMO_PROJECT_REF = "bnzrnizrmonjxlktbhlp";
  env.NEXT_PUBLIC_SUPABASE_DEMO_URL = "https://bnzrnizrmonjxlktbhlp.supabase.co";
  env.SUPABASE_DEMO_DB_URL =
    "postgresql://postgres:password@db.bnzrnizrmonjxlktbhlp.supabase.co:5432/postgres";
  env.SUPABASE_DEMO_ALLOWED_PROJECT_REFS = "bnzrnizrmonjxlktbhlp";
  env.NEXT_PUBLIC_SUPABASE_DEMO_ANON_KEY = jwt("anon", "bnzrnizrmonjxlktbhlp");
  env.SUPABASE_DEMO_SERVICE_ROLE_KEY = jwt("service_role", "bnzrnizrmonjxlktbhlp");
  rejected(env);
});

test("rechaza referencias vacías", () => {
  const env = validEnv();
  env.SUPABASE_DEMO_PROJECT_REF = "";
  rejected(env);
});

test("rechaza URL y referencia mezcladas", () => {
  const env = validEnv();
  env.NEXT_PUBLIC_SUPABASE_DEMO_URL =
    "https://abcdefghijklmnopqrst.supabase.co";
  rejected(env);
});

test("rechaza conexión Postgres de otro proyecto", () => {
  const env = validEnv();
  env.SUPABASE_DEMO_DB_URL =
    "postgresql://postgres:password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
  rejected(env);
});

test("rechaza claves con referencia contradictoria", () => {
  const env = validEnv();
  env.SUPABASE_DEMO_SERVICE_ROLE_KEY =
    jwt("service_role", "abcdefghijklmnopqrst");
  rejected(env);
});

test("rechaza allowlist incompleta o ambigua", () => {
  const env = validEnv();
  env.SUPABASE_DEMO_ALLOWED_PROJECT_REFS =
    `${demoRef},abcdefghijklmnopqrst`;
  rejected(env);
});

test("rechaza confirmación ausente", () => {
  const env = validEnv();
  delete env.DEMO_OPERATION_CONFIRMATION;
  rejected(env);
});

test("rechaza ambiente contradictorio", () => {
  const env = validEnv();
  env.SUPABASE_ENVIRONMENT = "production";
  rejected(env);
});
