import { createClient } from "@supabase/supabase-js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "pruebas RLS A/B P0.5",
  writeCapable: false,
});
const password = String(process.env.CONDOMINIOS_DEMO_PASSWORD || "");
if (password.length < 20) throw new Error("Contraseña demo ausente.");

const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(config.url, config.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const condosResult = await admin
  .from("condominios")
  .select("id,nombre,total_unidades")
  .eq("notas", marker);
if (condosResult.error || condosResult.data?.length !== 2) {
  throw new Error("No están disponibles exactamente los tenants demo A/B.");
}
const condoA = condosResult.data.find((item) => item.total_unidades === 60);
const condoB = condosResult.data.find((item) => item.total_unidades === 12);

async function clientFor(scope, role) {
  const email = `p05.${scope}.${role}@example.invalid`;
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) {
    throw new Error(`No se pudo autenticar el usuario ficticio ${scope}:${role}.`);
  }
  return client;
}

const clients = {
  leaderA: await clientFor("a", "lider_cuenta"),
  leaderB: await clientFor("b", "lider_cuenta"),
  condoA: await clientFor("a", "condomino"),
  condoB: await clientFor("b", "condomino"),
  multiA: await clientFor("a", "multiunidad"),
  readonlyA: await clientFor("a", "solo_lectura"),
  committeeA: await clientFor("a", "comite"),
  maintenanceA: await clientFor("a", "mantenimiento"),
};

const results = [];
async function check(name, assertion) {
  try {
    await assertion();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function onlyCondo(rows, id) {
  return rows.length > 0 && rows.every((row) => row.id === id);
}

await check("1. anónimo no puede listar condominios", async () => {
  const response = await anon.from("condominios").select("id");
  assert(Boolean(response.error) || response.data?.length === 0, "anónimo obtuvo filas");
});

await check("2. líder A sólo lista A", async () => {
  const response = await clients.leaderA.from("condominios").select("id");
  assert(!response.error && onlyCondo(response.data, condoA.id), "líder A vio otro tenant");
});

await check("3. líder B sólo lista B", async () => {
  const response = await clients.leaderB.from("condominios").select("id");
  assert(!response.error && onlyCondo(response.data, condoB.id), "líder B vio otro tenant");
});

await check("4. líder A no obtiene B por ID conocido", async () => {
  const response = await clients.leaderA.from("condominios").select("id").eq("id", condoB.id);
  assert(!response.error && response.data.length === 0, "líder A obtuvo B");
});

await check("5. líder B no obtiene A por ID conocido", async () => {
  const response = await clients.leaderB.from("condominios").select("id").eq("id", condoA.id);
  assert(!response.error && response.data.length === 0, "líder B obtuvo A");
});

await check("6. condómino A sólo ve su tenant", async () => {
  const response = await clients.condoA.from("condominios").select("id");
  assert(!response.error && onlyCondo(response.data, condoA.id), "condómino A vio otro tenant");
});

await check("7. condómino A sólo ve una unidad asignada", async () => {
  const response = await clients.condoA.from("unidades_condominio").select("id,condominio_id");
  assert(
    !response.error
      && response.data.length === 1
      && response.data[0].condominio_id === condoA.id,
    "alcance de unidad incorrecto",
  );
});

await check("8. propietario multiunidad ve exactamente dos unidades A", async () => {
  const response = await clients.multiA.from("unidades_condominio").select("id,condominio_id");
  assert(
    !response.error
      && response.data.length === 2
      && response.data.every((row) => row.condominio_id === condoA.id),
    "alcance multiunidad incorrecto",
  );
});

await check("9. propietario multiunidad no ve unidades B", async () => {
  const response = await clients.multiA
    .from("unidades_condominio")
    .select("id")
    .eq("condominio_id", condoB.id);
  assert(!response.error && response.data.length === 0, "multiunidad A vio B");
});

await check("10. sólo lectura no puede insertar condominio", async () => {
  const response = await clients.readonlyA
    .from("condominios")
    .insert({ nombre: "NO DEBE CREARSE", total_unidades: 1 });
  assert(Boolean(response.error), "escritura directa permitida");
});

await check("11. condómino no puede insertar pago", async () => {
  const response = await clients.condoA
    .from("condominio_pagos")
    .insert({
      condominio_id: condoA.id,
      unidad_id: "00000000-0000-0000-0000-000000000000",
      periodo: "2026-07",
      monto: 1,
      fecha_pago: "2026-07-17",
      created_by: "00000000-0000-0000-0000-000000000000",
    });
  assert(Boolean(response.error), "pago directo permitido");
});

await check("12. comité A sólo lee auditoría A", async () => {
  const response = await clients.committeeA
    .from("condominio_audit_log")
    .select("condominio_id");
  assert(
    !response.error
      && response.data.length > 0
      && response.data.every((row) => row.condominio_id === condoA.id),
    "comité A vio auditoría ajena",
  );
});

const docAResult = await admin
  .from("condominio_documentos")
  .select("id")
  .eq("condominio_id", condoA.id)
  .limit(1)
  .single();
const docBResult = await admin
  .from("condominio_documentos")
  .select("id")
  .eq("condominio_id", condoB.id)
  .limit(1)
  .single();
if (docAResult.error || docBResult.error) throw new Error("Documentos A/B no disponibles.");

await check("13. líder A no obtiene documento B por ID conocido", async () => {
  const response = await clients.leaderA
    .from("condominio_documentos")
    .select("id")
    .eq("id", docBResult.data.id);
  assert(!response.error && response.data.length === 0, "líder A obtuvo documento B");
});

await check("14. líder B no obtiene documento A por ID conocido", async () => {
  const response = await clients.leaderB
    .from("condominio_documentos")
    .select("id")
    .eq("id", docAResult.data.id);
  assert(!response.error && response.data.length === 0, "líder B obtuvo documento A");
});

await check("15. líder A tiene registrar_gasto sólo en A", async () => {
  const allowedA = await clients.leaderA.rpc("condominio_usuario_puede_actual", {
    p_condominio_id: condoA.id,
    p_accion: "registrar_gasto",
    p_unidad_id: null,
  });
  const allowedB = await clients.leaderA.rpc("condominio_usuario_puede_actual", {
    p_condominio_id: condoB.id,
    p_accion: "registrar_gasto",
    p_unidad_id: null,
  });
  assert(!allowedA.error && allowedA.data === true, "permiso A ausente");
  assert(!allowedB.error && allowedB.data === false, "permiso B concedido");
});

await check("16. sólo lectura carece de permisos de escritura", async () => {
  const response = await clients.readonlyA.rpc("condominio_usuario_puede_actual", {
    p_condominio_id: condoA.id,
    p_accion: "registrar_pago",
    p_unidad_id: null,
  });
  assert(!response.error && response.data === false, "sólo lectura puede escribir");
});

await check("17. condómino A no puede leer cuotas de otra unidad A", async () => {
  const ownUnits = await clients.condoA.from("unidades_condominio").select("id").single();
  if (ownUnits.error) throw ownUnits.error;
  const otherUnit = await admin
    .from("unidades_condominio")
    .select("id")
    .eq("condominio_id", condoA.id)
    .neq("id", ownUnits.data.id)
    .limit(1)
    .single();
  if (otherUnit.error) throw otherUnit.error;
  const response = await clients.condoA
    .from("cuotas_condominio")
    .select("id")
    .eq("unidad_id", otherUnit.data.id);
  assert(!response.error && response.data.length === 0, "condómino vio cuotas de otra unidad");
});

await Promise.all(
  Object.values(clients).map((client) => client.auth.signOut()),
);

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({
  projectRef: config.projectRef,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}, null, 2));
if (failed.length) process.exitCode = 1;
