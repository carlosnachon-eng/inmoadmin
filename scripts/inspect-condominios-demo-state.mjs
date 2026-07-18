import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "inventario de estado demo P0.5",
  writeCapable: false,
});
const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const condos = await admin.from("condominios").select("id,total_unidades").eq("notas", marker);
if (condos.error) throw condos.error;
const ids = condos.data.map((item) => item.id);
const tables = [
  "condominios","unidades_condominio","cuotas_condominio","gastos_condominio",
  "condominio_miembros","condominio_periodos","condominio_pagos",
  "condominio_saldos_iniciales","condominio_documentos","condominio_audit_log",
  "condominio_import_batches","condominio_exportaciones",
];
const counts = {};
for (const table of tables) {
  let query = admin.from(table).select("id", { count: "exact", head: true });
  if (table === "condominios") query = query.in("id", ids);
  else query = query.in("condominio_id", ids);
  const response = await query;
  if (response.error) throw response.error;
  counts[table] = response.count;
}
const users = await admin.auth.admin.listUsers({ perPage: 1000 });
if (users.error) throw users.error;
const demoUsers = users.data.users.filter((item) => item.user_metadata?.p05_marker === marker);
const documents = await admin
  .from("condominio_documentos")
  .select("id,condominio_id,bucket,object_path,sha256")
  .in("condominio_id", ids);
if (documents.error) throw documents.error;
const fingerprint = crypto
  .createHash("sha256")
  .update(JSON.stringify({
    unitCounts: condos.data.map((item) => item.total_unidades).sort((a, b) => a - b),
    counts,
    documentHashes: documents.data.map((item) => item.sha256).filter(Boolean).sort(),
  }))
  .digest("hex");
console.log(JSON.stringify({
  projectRef: config.projectRef,
  tenants: condos.data.length,
  expectedUnits: condos.data.map((item) => item.total_unidades).sort((a, b) => a - b),
  demoUsers: demoUsers.length,
  counts,
  documentRecords: documents.data.length,
  logicalFingerprint: fingerprint,
}, null, 2));
