import crypto from "node:crypto";

export const DEMO_ABORT_MESSAGE =
  "OPERACIÓN CANCELADA: EL DESTINO NO ESTÁ CONFIRMADO COMO AMBIENTE DEMO.";

export const KNOWN_PRODUCTION_REFS = Object.freeze([
  "bnzrnizrmonjxlktbhlp",
]);

export const KNOWN_PRODUCTION_URLS = Object.freeze([
  "https://bnzrnizrmonjxlktbhlp.supabase.co",
]);

const CONFIRMATION = "I_ACKNOWLEDGE_DEMO_ONLY";

function fail(detail) {
  const error = new Error(`${DEMO_ABORT_MESSAGE}\n${detail}`);
  error.code = "DEMO_TARGET_REJECTED";
  throw error;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    fail(`${label} no es una URL válida.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    fail(`${label} debe usar HTTPS y no contener credenciales.`);
  }
  return parsed;
}

function refFromSupabaseUrl(parsed) {
  const match = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (!match || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("La URL demo no corresponde al formato canónico de un proyecto Supabase.");
  }
  return match[1];
}

function refFromDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    fail("SUPABASE_DEMO_DB_URL no es una conexión Postgres válida.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail("SUPABASE_DEMO_DB_URL debe usar el protocolo postgres.");
  }
  const direct = parsed.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  if (direct) return direct[1];

  const userRef = decodeURIComponent(parsed.username || "").match(/^postgres\.([a-z0-9]{20})$/);
  if (userRef && /\.pooler\.supabase\.com$/.test(parsed.hostname)) return userRef[1];
  fail("No fue posible comprobar el Project Reference de SUPABASE_DEMO_DB_URL.");
}

function decodeJwtPayload(token, label) {
  const pieces = String(token || "").split(".");
  if (pieces.length !== 3) fail(`${label} no es una clave JWT compatible.`);
  try {
    return JSON.parse(Buffer.from(pieces[1], "base64url").toString("utf8"));
  } catch {
    fail(`${label} no contiene un payload JWT válido.`);
  }
}

function assertKey(token, expectedRole, expectedRef, label) {
  const payload = decodeJwtPayload(token, label);
  if (payload.role !== expectedRole || payload.ref !== expectedRef) {
    fail(`${label} no pertenece al proyecto demo o tiene un rol inesperado.`);
  }
}

function maskUrl(value) {
  const parsed = new URL(value);
  const prefix = parsed.hostname.slice(0, 4);
  return `${parsed.protocol}//${prefix}…${parsed.hostname.slice(-16)}`;
}

export function validateDemoEnvironment(
  env = process.env,
  { operation = "validación local", writeCapable = false, log = console.info } = {},
) {
  if (env.APP_ENV !== "demo" || env.SUPABASE_ENVIRONMENT !== "demo") {
    fail("APP_ENV y SUPABASE_ENVIRONMENT deben ser exactamente demo.");
  }
  if (env.DEMO_OPERATION_CONFIRMATION !== CONFIRMATION) {
    fail(`Falta DEMO_OPERATION_CONFIRMATION=${CONFIRMATION}.`);
  }

  const projectName = String(env.SUPABASE_DEMO_PROJECT_NAME || "").trim();
  const projectRef = String(env.SUPABASE_DEMO_PROJECT_REF || "").trim();
  if (!/^inmoadmin-condominios-demo$/i.test(projectName)) {
    fail("El nombre explícito del proyecto no identifica el demo de condominios.");
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    fail("SUPABASE_DEMO_PROJECT_REF está vacío o tiene formato inválido.");
  }

  const demoUrl = normalizeUrl(env.NEXT_PUBLIC_SUPABASE_DEMO_URL, "NEXT_PUBLIC_SUPABASE_DEMO_URL");
  const urlRef = refFromSupabaseUrl(demoUrl);
  if (urlRef !== projectRef) fail("La URL demo y el Project Reference no coinciden.");

  const blockedRefs = new Set([
    ...KNOWN_PRODUCTION_REFS,
    ...splitList(env.SUPABASE_PRODUCTION_PROJECT_REF_BLOCKLIST),
  ]);
  const blockedUrls = new Set([
    ...KNOWN_PRODUCTION_URLS,
    ...splitList(env.SUPABASE_PRODUCTION_URL_BLOCKLIST),
  ]);
  if (blockedRefs.has(projectRef) || blockedRefs.has(urlRef)) {
    fail("El Project Reference activo está identificado como producción.");
  }
  if (blockedUrls.has(demoUrl.origin)) {
    fail("La URL activa está identificada como producción.");
  }

  const allowedRefs = splitList(env.SUPABASE_DEMO_ALLOWED_PROJECT_REFS);
  if (allowedRefs.length !== 1 || allowedRefs[0] !== projectRef) {
    fail("La allowlist demo debe contener únicamente el Project Reference activo.");
  }

  const dbRef = refFromDatabaseUrl(env.SUPABASE_DEMO_DB_URL);
  if (dbRef !== projectRef || blockedRefs.has(dbRef)) {
    fail("La conexión Postgres no pertenece al proyecto demo permitido.");
  }

  assertKey(
    env.NEXT_PUBLIC_SUPABASE_DEMO_ANON_KEY,
    "anon",
    projectRef,
    "NEXT_PUBLIC_SUPABASE_DEMO_ANON_KEY",
  );
  assertKey(
    env.SUPABASE_DEMO_SERVICE_ROLE_KEY,
    "service_role",
    projectRef,
    "SUPABASE_DEMO_SERVICE_ROLE_KEY",
  );

  const credentialFingerprint = crypto
    .createHash("sha256")
    .update(String(env.SUPABASE_DEMO_SERVICE_ROLE_KEY))
    .digest("hex");
  if (splitList(env.SUPABASE_PRODUCTION_CREDENTIAL_SHA256_BLOCKLIST).includes(credentialFingerprint)) {
    fail("La credencial privilegiada está registrada como credencial de producción.");
  }

  const summary = {
    environment: "DEMO",
    projectName,
    projectRef,
    maskedUrl: maskUrl(demoUrl.origin),
    operation,
    writeCapable: Boolean(writeCapable),
    productionBlocked: true,
  };
  log(`[DEMO GUARD] ${JSON.stringify(summary)}`);

  return Object.freeze({
    ...summary,
    url: demoUrl.origin,
    anonKey: env.NEXT_PUBLIC_SUPABASE_DEMO_ANON_KEY,
    serviceRoleKey: env.SUPABASE_DEMO_SERVICE_ROLE_KEY,
    databaseUrl: env.SUPABASE_DEMO_DB_URL,
  });
}
