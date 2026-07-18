import crypto from "node:crypto";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import autoTableModule from "jspdf-autotable";
import { createClient } from "@supabase/supabase-js";
import { toCsv } from "../lib/server/csv.js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "exportación ZIP real P0.5",
  writeCapable: true,
});
const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const autoTable = autoTableModule?.default || autoTableModule;
if (typeof autoTable !== "function") throw new Error("Plugin PDF autoTable no disponible.");
const condos = await admin
  .from("condominios")
  .select("*")
  .eq("notas", marker);
if (condos.error || condos.data.length !== 2) throw new Error("Tenants A/B no disponibles.");
const condoA = condos.data.find((item) => item.total_unidades === 60);
const condoB = condos.data.find((item) => item.total_unidades === 12);
const users = await admin.auth.admin.listUsers({ perPage: 1000 });
if (users.error) throw users.error;
const actorA = users.data.users.find((item) => item.email === "p05.a.lider_cuenta@example.invalid");
const actorB = users.data.users.find((item) => item.email === "p05.b.lider_cuenta@example.invalid");
const readonlyA = users.data.users.find((item) => item.email === "p05.a.solo_lectura@example.invalid");
if (!actorA || !actorB || !readonlyA) throw new Error("Actores demo no disponibles.");

async function canExport(actor, condominioId) {
  const response = await admin.rpc("condominio_usuario_puede", {
    p_user_id: actor.id,
    p_condominio_id: condominioId,
    p_accion: "exportar",
    p_unidad_id: null,
  });
  if (response.error) throw response.error;
  return response.data;
}
if (!(await canExport(actorA, condoA.id))) throw new Error("Líder A no puede exportar A.");
if (await canExport(actorB, condoA.id)) throw new Error("Líder B puede exportar A.");
if (await canExport(readonlyA, condoA.id)) throw new Error("Sólo lectura puede exportar A.");

const staleExports = await admin
  .from("condominio_exportaciones")
  .update({ estado: "fallida" })
  .eq("condominio_id", condoA.id)
  .eq("estado", "generando");
if (staleExports.error) throw staleExports.error;

const specs = [
  ["unidades", "unidades_condominio", ["id","numero","piso","propietario_nombre","propietario_email","residente_nombre","residente_email","activo"]],
  ["cuotas", "cuotas_condominio", ["id","unidad_id","periodo","monto","status","fecha_vencimiento","fecha_pago"]],
  ["pagos", "condominio_pagos", ["id","unidad_id","cuota_id","periodo","monto","fecha_pago","metodo","referencia","notas"]],
  ["gastos", "gastos_condominio", ["id","concepto","categoria","monto","fecha","notas"]],
  ["periodos", "condominio_periodos", ["id","periodo","estado","created_at"]],
  ["auditoria", "condominio_audit_log", ["id","occurred_at","actor_id","unidad_id","accion","entidad","entidad_id"]],
];

const exportRecord = await admin
  .from("condominio_exportaciones")
  .insert({ condominio_id: condoA.id, created_by: actorA.id })
  .select("*")
  .single();
if (exportRecord.error) throw exportRecord.error;

const zip = new JSZip();
const counts = {};
for (const [name, table, columns] of specs) {
  const response = await admin
    .from(table)
    .select(columns.join(","))
    .eq("condominio_id", condoA.id)
    .limit(10000);
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  counts[name] = response.data.length;
  zip.file(`datos/${name}.csv`, `\uFEFF${toCsv(response.data, columns)}`);
}
zip.file("datos/condominio.json", JSON.stringify(condoA, null, 2));

const docs = await admin
  .from("condominio_documentos")
  .select("*")
  .eq("condominio_id", condoA.id)
  .neq("categoria", "exportacion");
if (docs.error) throw docs.error;
const documentIndex = [];
for (const document of docs.data) {
  const download = await admin.storage.from(document.bucket).download(document.object_path);
  if (download.error) throw download.error;
  const bytes = Buffer.from(await download.data.arrayBuffer());
  const safeName = document.nombre_original.replace(/[^a-zA-Z0-9._-]/g, "_");
  zip.file(`documentos/${document.id}_${safeName}`, bytes);
  documentIndex.push({
    id: document.id,
    nombre: document.nombre_original,
    categoria: document.categoria,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}
zip.file("documentos/indice.json", JSON.stringify(documentIndex, null, 2));

const summary = new jsPDF({ unit: "pt", format: "letter" });
summary.setFontSize(18);
summary.text("Expediente ficticio de administración condominal", 40, 48);
summary.setFontSize(11);
summary.text(condoA.nombre, 40, 70);
autoTable(summary, {
  startY: 92,
  head: [["Sección", "Registros"]],
  body: Object.entries(counts).map(([name, count]) => [name, String(count)]),
});
zip.file("resumen.pdf", Buffer.from(summary.output("arraybuffer")));

const generatedAt = new Date().toISOString();
zip.file("manifest.json", JSON.stringify({
  version: 1,
  ambiente: "DEMO",
  marcador: marker,
  condominio_id: condoA.id,
  generado_en: generatedAt,
  conteos: counts,
  documentos: documentIndex.length,
}, null, 2));
const archive = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});
const sha256 = crypto.createHash("sha256").update(archive).digest("hex");

const loaded = await JSZip.loadAsync(archive);
const names = Object.keys(loaded.files).sort();
const textEntries = names.filter((name) => name.endsWith(".csv") || name.endsWith(".json"));
let searchable = "";
for (const name of textEntries) searchable += await loaded.file(name).async("string");
if (!names.includes("manifest.json") || !names.includes("resumen.pdf")) {
  throw new Error("ZIP incompleto.");
}
if (searchable.includes(condoB.id) || searchable.includes("propietario.b.")) {
  throw new Error("El ZIP A contiene identificadores o correos de B.");
}
if (!searchable.includes(condoA.id) || !searchable.includes("propietario.a.")) {
  throw new Error("El ZIP no contiene el tenant A esperado.");
}
const manifest = JSON.parse(await loaded.file("manifest.json").async("string"));
if (manifest.condominio_id !== condoA.id || manifest.documentos !== documentIndex.length) {
  throw new Error("Manifest inconsistente.");
}
const unidadesCsv = await loaded.file("datos/unidades.csv").async("string");
if (!unidadesCsv.startsWith("\uFEFF") || !unidadesCsv.includes("Propietario Ficticio")) {
  throw new Error("CSV no conserva BOM UTF-8 o contenido.");
}

const objectPath = `${condoA.id}/exportacion/${generatedAt.slice(0, 10)}/${exportRecord.data.id}.zip`;
const upload = await admin.storage
  .from("condominios-private")
  .upload(objectPath, archive, { contentType: "application/zip", upsert: false });
if (upload.error) throw upload.error;
const retentionDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const document = await admin
  .from("condominio_documentos")
  .insert({
    condominio_id: condoA.id,
    categoria: "exportacion",
    bucket: "condominios-private",
    object_path: objectPath,
    nombre_original: `p05-expediente-${condoA.id}.zip`,
    mime_type: "application/zip",
    size_bytes: archive.length,
    sha256,
    retencion_hasta: retentionDate,
    created_by: actorA.id,
  })
  .select("*")
  .single();
if (document.error) throw document.error;
const completed = await admin
  .from("condominio_exportaciones")
  .update({
    estado: "lista",
    documento_id: document.data.id,
    sha256,
    completed_at: generatedAt,
  })
  .eq("id", exportRecord.data.id)
  .eq("condominio_id", condoA.id);
if (completed.error) throw completed.error;
const audit = await admin.rpc("condominio_auditar", {
  p_actor: actorA.id,
  p_condominio: condoA.id,
  p_unidad: null,
  p_accion: "exportar",
  p_entidad: "condominio_exportaciones",
  p_entidad_id: exportRecord.data.id,
  p_motivo: "Validación P0.5 con datos ficticios",
  p_antes: null,
  p_despues: { documento_id: document.data.id, sha256, counts, retentionDate },
  p_request_id: `p05-export-${crypto.randomUUID()}`,
});
if (audit.error) throw audit.error;

const publicUrl = admin.storage.from("condominios-private").getPublicUrl(objectPath).data.publicUrl;
const publicResponse = await fetch(publicUrl, { redirect: "manual" });
if (publicResponse.ok) throw new Error("El ZIP quedó accesible por URL pública.");
const signed = await admin.storage.from("condominios-private").createSignedUrl(objectPath, 60);
if (signed.error || !(await fetch(signed.data.signedUrl)).ok) {
  throw new Error("El ZIP privado no abre con URL firmada.");
}

console.log(JSON.stringify({
  projectRef: config.projectRef,
  condominio: "A",
  exportacionId: exportRecord.data.id,
  documentoId: document.data.id,
  archiveBytes: archive.length,
  sha256,
  retentionDate,
  counts,
  documentsIncluded: documentIndex.length,
  zipEntries: names,
  crossTenantDataFound: false,
  publicAccess: false,
  signedAccess: true,
  unauthorizedExportRejected: true,
}, null, 2));
