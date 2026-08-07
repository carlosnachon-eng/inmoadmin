import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validateUnitCsv } from "../lib/server/csv.js";
import {
  completeIdempotency,
  reserveIdempotency,
} from "../lib/server/condominiosIdempotency.js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "pruebas de importación P0.5",
  writeCapable: true,
});
const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const condos = await admin.from("condominios").select("id,total_unidades").eq("notas", marker);
if (condos.error || condos.data.length !== 2) throw new Error("Tenants A/B no disponibles.");
const condoA = condos.data.find((item) => item.total_unidades === 60);
const condoB = condos.data.find((item) => item.total_unidades === 12);
const users = await admin.auth.admin.listUsers({ perPage: 1000 });
if (users.error) throw users.error;
const actor = users.data.users.find(
  (item) => item.email === "p05.a.lider_cuenta@example.invalid",
);
if (!actor) throw new Error("Actor demo A no disponible.");

const UNIT_HEADER = [
  "numero","piso","propietario_nombre","propietario_email","propietario_telefono",
  "residente_nombre","residente_email","residente_telefono","residente_es_propietario","notas",
].join(",");
const countUnits = async (condominioId) => {
  const result = await admin
    .from("unidades_condominio")
    .select("id", { count: "exact", head: true })
    .eq("condominio_id", condominioId);
  if (result.error) throw result.error;
  return result.count;
};
const initialA = await countUnits(condoA.id);
const initialB = await countUnits(condoB.id);
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
async function createBatch(rows, errors = []) {
  const result = await admin
    .from("condominio_import_batches")
    .insert({
      condominio_id: condoA.id,
      filas: rows,
      errores: errors,
      hash: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (result.error) throw result.error;
  return result.data;
}
async function applyBatch(batch) {
  return admin.rpc("condominio_aplicar_importacion", {
    p_actor: actor.id,
    p_batch: batch.id,
    p_request_id: `p05-import-${crypto.randomUUID()}`,
  });
}

let createdUnitNumber = null;
let originalUnit;
try {
  await check("1. CSV válido se analiza y aplica", async () => {
    createdUnitNumber = "A-P05-NUEVA";
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\r\n${createdUnitNumber},7,Propietario Nuevo,p05.nuevo@example.invalid,,,,,false,Alta ficticia`,
    );
    assert(parsed.errors.length === 0 && parsed.rows.length === 1, "preview inválido");
    const batch = await createBatch(parsed.rows, parsed.errors);
    const applied = await applyBatch(batch);
    assert(!applied.error && applied.data.filas_aplicadas === 1, "commit falló");
    assert(await countUnits(condoA.id) === initialA + 1, "conteo A no aumentó");
  });

  await check("2. encabezados incorrectos son rechazados", async () => {
    let rejected = false;
    try {
      validateUnitCsv("unidad,nombre\n1,Prueba");
    } catch {
      rejected = true;
    }
    assert(rejected, "encabezado incorrecto aceptado");
  });

  await check("3. comas y comillas se conservan", async () => {
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\nA-COMILLAS,1,"Pérez, Ana",p05.comas@example.invalid,,,,,false,"Nota ""especial"", demo"`,
    );
    assert(parsed.errors.length === 0, "CSV entrecomillado rechazado");
    assert(parsed.rows[0].propietario_nombre === "Pérez, Ana", "coma no conservada");
    assert(parsed.rows[0].notas === 'Nota "especial", demo', "comillas no conservadas");
  });

  await check("4. duplicados dentro del CSV son detectados", async () => {
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\nA-DUP,1,Uno,,,,,,,demo\nA-DUP,1,Dos,,,,,,,demo`,
    );
    assert(parsed.errors.some((item) => item.mensaje.includes("duplicada")), "duplicado no detectado");
  });

  await check("5. correos inválidos son detectados", async () => {
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\nA-EMAIL,1,Uno,no-es-correo,,,,,,demo`,
    );
    assert(parsed.errors.some((item) => item.campo === "propietario_email"), "correo inválido aceptado");
  });

  await check("6. número obligatorio vacío es detectado", async () => {
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\n,1,Sin número,p05.sin.numero@example.invalid,,,,,,demo`,
    );
    assert(parsed.errors.some((item) => item.campo === "numero"), "campo obligatorio aceptado");
  });

  await check("7. CSV parcialmente válido no modifica datos", async () => {
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\nA-PARCIAL-OK,1,Válido,p05.valido@example.invalid,,,,,,demo\n,1,Inválido,p05.invalido@example.invalid,,,,,,demo`,
    );
    assert(parsed.errors.length > 0, "preview no detectó error");
    const before = await countUnits(condoA.id);
    const batch = await createBatch(parsed.rows, parsed.errors);
    const applied = await applyBatch(batch);
    assert(Boolean(applied.error), "batch con errores fue aplicado");
    assert(await countUnits(condoA.id) === before, "batch parcial alteró conteo");
  });

  await check("8. contenido no CSV no supera el contrato", async () => {
    let rejected = false;
    try {
      validateUnitCsv("%PDF-1.7 contenido binario ficticio");
    } catch {
      rejected = true;
    }
    assert(rejected, "contenido no CSV aceptado");
  });

  await check("9. interrupción simulada revierte todas las filas", async () => {
    const before = await countUnits(condoA.id);
    const validRow = Object.fromEntries(
      UNIT_HEADER.split(",").map((column) => [column, ""]),
    );
    validRow.numero = "A-ROLLBACK-TEMP";
    validRow.propietario_nombre = "Temporal";
    validRow.residente_es_propietario = false;
    const invalidRow = { ...validRow, numero: null };
    const batch = await createBatch([validRow, invalidRow], []);
    const applied = await applyBatch(batch);
    assert(Boolean(applied.error), "fallo simulado no fue rechazado");
    assert(await countUnits(condoA.id) === before, "transacción parcial persistió");
    const leaked = await admin
      .from("unidades_condominio")
      .select("id")
      .eq("condominio_id", condoA.id)
      .eq("numero", "A-ROLLBACK-TEMP");
    assert(!leaked.error && leaked.data.length === 0, "fila temporal quedó persistida");
  });

  await check("10. reintento de batch aplicado no duplica", async () => {
    const parsed = validateUnitCsv(
      `${UNIT_HEADER}\nA-IDEMPOTENTE,1,Idempotente,p05.idempotente@example.invalid,,,,,,demo`,
    );
    const batch = await createBatch(parsed.rows, parsed.errors);
    const first = await applyBatch(batch);
    const countAfterFirst = await countUnits(condoA.id);
    const second = await applyBatch(batch);
    assert(!first.error && Boolean(second.error), "reintento no fue controlado");
    assert(await countUnits(condoA.id) === countAfterFirst, "reintento duplicó filas");
    await admin
      .from("unidades_condominio")
      .delete()
      .eq("condominio_id", condoA.id)
      .eq("numero", "A-IDEMPOTENTE");
  });

  await check("11. unidad existente se actualiza sin borrar las demás", async () => {
    const current = await admin
      .from("unidades_condominio")
      .select("*")
      .eq("condominio_id", condoA.id)
      .eq("numero", "A-001")
      .single();
    if (current.error) throw current.error;
    originalUnit = current.data;
    const row = {
      numero: "A-001",
      piso: String(current.data.piso || ""),
      propietario_nombre: "Propietario Actualizado P0.5",
      propietario_email: current.data.propietario_email || "",
      propietario_telefono: current.data.propietario_telefono || "",
      residente_nombre: current.data.residente_nombre || "",
      residente_email: current.data.residente_email || "",
      residente_telefono: current.data.residente_telefono || "",
      residente_es_propietario: Boolean(current.data.residente_es_propietario),
      notas: marker,
    };
    const before = await countUnits(condoA.id);
    const batch = await createBatch([row], []);
    const applied = await applyBatch(batch);
    const updated = await admin
      .from("unidades_condominio")
      .select("propietario_nombre")
      .eq("id", current.data.id)
      .single();
    assert(!applied.error, "upsert falló");
    assert(await countUnits(condoA.id) === before, "upsert cambió conteo");
    assert(updated.data.propietario_nombre === row.propietario_nombre, "upsert no actualizó");
  });

  await check("12. todas las pruebas A preservan intacto B", async () => {
    assert(await countUnits(condoB.id) === initialB, "conteo B cambió");
  });

  await check("13. reserva idempotente devuelve la respuesta cacheada", async () => {
    const key = `p05-${crypto.randomUUID()}`;
    const payload = { action: "import-test", tenant: condoA.id };
    const first = await reserveIdempotency({
      supabase: admin,
      actorId: actor.id,
      condominioId: condoA.id,
      key,
      payload,
    });
    assert(first.cached === false, "primera reserva ya estaba cacheada");
    await completeIdempotency({
      supabase: admin,
      actorId: actor.id,
      condominioId: condoA.id,
      key,
      response: { ok: true },
    });
    const second = await reserveIdempotency({
      supabase: admin,
      actorId: actor.id,
      condominioId: condoA.id,
      key,
      payload,
    });
    assert(second.cached === true && second.response.ok === true, "cache idempotente ausente");
  });
} finally {
  if (createdUnitNumber) {
    await admin
      .from("unidades_condominio")
      .delete()
      .eq("condominio_id", condoA.id)
      .eq("numero", createdUnitNumber);
  }
  if (originalUnit) {
    await admin
      .from("unidades_condominio")
      .update({
        propietario_nombre: originalUnit.propietario_nombre,
        notas: originalUnit.notas,
      })
      .eq("id", originalUnit.id)
      .eq("condominio_id", condoA.id);
  }
}

const finalA = await countUnits(condoA.id);
const finalB = await countUnits(condoB.id);
const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({
  projectRef: config.projectRef,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  initialCounts: { A: initialA, B: initialB },
  finalCounts: { A: finalA, B: finalB },
  results,
}, null, 2));
if (failed.length || finalA !== initialA || finalB !== initialB) process.exitCode = 1;
