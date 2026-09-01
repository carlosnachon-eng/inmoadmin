import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

assert.ok(url?.includes("hjfwjnejbcpmknvfpdcq"), "Supabase DEV target requerido");
assert.ok(publicKey, "SUPABASE_ANON_KEY requerida");
assert.ok(secretKey, "SUPABASE_SECRET_KEY requerida");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secretKey, options);
const anonymous = createClient(url, publicKey, options);
const suffix = crypto.randomBytes(8).toString("hex");
const emails = {
  internal: `qa-p0-internal-${suffix}@example.invalid`,
  inactive: `qa-p0-inactive-${suffix}@example.invalid`,
  owner: `qa-p0-owner-${suffix}@example.invalid`,
  owner2: `qa-p0-owner2-${suffix}@example.invalid`,
  antive: `qa-p0-antive-${suffix}@example.invalid`,
};
const users = [];

async function createUser(email, userMetadata = {}, appMetadata = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  });
  assert.ifError(error);
  assert.ok(data.user?.id);
  users.push(data.user);
  return data.user;
}

async function sessionFor(email, type = "magiclink") {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type, email });
  assert.ifError(linkError);
  assert.ok(link.properties?.hashed_token);
  const client = createClient(url, publicKey, options);
  const { data, error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type });
  assert.ifError(error);
  assert.ok(data.session?.access_token);
  return client;
}

async function visibleProfileCount(client) {
  const { data, error } = await client.from("profiles").select("id,role_id,active");
  assert.ifError(error);
  return data.length;
}

try {
  const internal = await createUser(emails.internal);
  const inactive = await createUser(emails.inactive);
  await createUser(emails.owner, { rol_pretendido: "propietario" });
  await createUser(emails.owner2, { rol_pretendido: "propietario" });
  const antiveUser = await createUser(emails.antive, {}, { identity_type: "antive_transition" });

  const { error: internalUpdateError } = await admin.from("profiles").update({ role_id: "admin", active: true }).eq("id", internal.id);
  assert.ifError(internalUpdateError);
  const { error: inactiveUpdateError } = await admin.from("profiles").update({ role_id: "admin", active: false }).eq("id", inactive.id);
  assert.ifError(inactiveUpdateError);
  const { error: antiveUpdateError } = await admin.from("profiles").update({ role_id: "antive_transition", active: true }).eq("id", antiveUser.id);
  assert.ifError(antiveUpdateError);

  const anonRead = await anonymous.from("profiles").select("id");
  assert.ok(anonRead.error, "anon SELECT debe ser rechazado");
  const anonInsert = await anonymous.from("profiles").insert({ id: crypto.randomUUID() });
  assert.ok(anonInsert.error, "anon INSERT debe ser rechazado");

  const ownerClient = await sessionFor(emails.owner);
  assert.equal(await visibleProfileCount(ownerClient), 1, "propietario sólo ve su fila");
  const ownerUpdate = await ownerClient.from("profiles").update({ full_name: "forbidden" }).eq("email", emails.owner);
  assert.ok(ownerUpdate.error, "propietario no puede actualizar profiles");

  const owner2Client = await sessionFor(emails.owner2);
  assert.equal(await visibleProfileCount(owner2Client), 1, "otro propietario sólo ve su fila");

  const antiveClient = await sessionFor(emails.antive);
  assert.equal(await visibleProfileCount(antiveClient), 1, "Antive sólo ve su fila");

  const internalClient = await sessionFor(emails.internal);
  assert.ok((await visibleProfileCount(internalClient)) >= users.length, "interno activo conserva directorio");

  const inactiveClient = await sessionFor(emails.inactive);
  assert.equal(await visibleProfileCount(inactiveClient), 0, "interno inactivo queda bloqueado por Phase 0");

  const recoveryClient = await sessionFor(emails.owner, "recovery");
  assert.equal(await visibleProfileCount(recoveryClient), 1, "recovery conserva self-select");

  const invalid = await admin.auth.admin.createUser({
    email: `qa-p0-invalid-${suffix}@example.invalid`,
    email_confirm: true,
    user_metadata: { rol_pretendido: "admin" },
  });
  assert.ok(invalid.error, "rol privilegiado inesperado debe fallar controladamente");
  if (invalid.data?.user) users.push(invalid.data.user);

  process.stdout.write(JSON.stringify({
    result: "PROFILES_HARDENING_P0_POSTGREST_OK",
    users_created: users.length,
    anon_denied: true,
    external_self_only: true,
    internal_directory: true,
    inactive_blocked: true,
    otp_magiclink: true,
    recovery: true,
  }));
} finally {
  for (const user of users.reverse()) {
    await admin.auth.admin.deleteUser(user.id, false);
  }
}
