import { createClient } from "@supabase/supabase-js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "limpieza de datos ficticios P0.5",
  writeCapable: true,
});
const supabase = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const { data: condos, error: condoError } = await supabase
  .from("condominios")
  .select("id,nombre,notas")
  .eq("notas", marker);
if (condoError) throw condoError;
if (condos.length !== 2 || condos.some((item) => item.notas !== marker)) {
  throw new Error("No se encontraron exactamente los dos tenants P0.5; no se eliminó nada.");
}
const condoIds = condos.map((item) => item.id);

const { data: documents, error: documentError } = await supabase
  .from("condominio_documentos")
  .select("bucket,object_path")
  .in("condominio_id", condoIds);
if (documentError) throw documentError;
const grouped = (documents || []).reduce((result, item) => {
  result[item.bucket] ||= [];
  result[item.bucket].push(item.object_path);
  return result;
}, {});
for (const [bucket, paths] of Object.entries(grouped)) {
  const removal = await supabase.storage.from(bucket).remove(paths);
  if (removal.error) throw removal.error;
}

for (const table of [
  "condominio_audit_log",
  "condominio_exportaciones",
  "condominio_import_batches",
  "condominio_documentos",
  "condominio_pagos",
  "condominio_saldos_iniciales",
  "condominio_periodos",
  "gastos_condominio",
  "cuotas_condominio",
  "condominio_miembros",
  "unidades_condominio",
]) {
  const result = await supabase.from(table).delete().in("condominio_id", condoIds);
  if (result.error) throw result.error;
}
const removal = await supabase.from("condominios").delete().in("id", condoIds);
if (removal.error) throw removal.error;

const usersResult = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (usersResult.error) throw usersResult.error;
for (const user of usersResult.data.users.filter(
  (item) => item.user_metadata?.p05_marker === marker,
)) {
  const result = await supabase.auth.admin.deleteUser(user.id);
  if (result.error) throw result.error;
}
console.log(JSON.stringify({
  ok: true,
  projectRef: config.projectRef,
  tenants_eliminados: condoIds.length,
  usuarios_eliminados: usersResult.data.users.filter(
    (item) => item.user_metadata?.p05_marker === marker,
  ).length,
}, null, 2));
