import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { jsPDF } from "jspdf";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "pruebas de recibo y proveedor P0.5",
  writeCapable: true,
});
const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = String(process.env.CONDOMINIOS_DEMO_PASSWORD || "");
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const condos = await admin.from("condominios").select("id,nombre,total_unidades").eq("notas", marker);
if (condos.error || condos.data.length !== 2) throw new Error("Tenants A/B no disponibles.");
const condoA = condos.data.find((item) => item.total_unidades === 60);
const condoB = condos.data.find((item) => item.total_unidades === 12);
const fee = await admin
  .from("cuotas_condominio")
  .select("id,condominio_id,unidad_id,periodo,monto,status,fecha_pago")
  .eq("condominio_id", condoA.id)
  .eq("status", "pagado")
  .limit(1)
  .single();
if (fee.error) throw fee.error;
const unit = await admin
  .from("unidades_condominio")
  .select("*")
  .eq("id", fee.data.unidad_id)
  .single();
if (unit.error) throw unit.error;
const payment = await admin
  .from("condominio_pagos")
  .select("*")
  .eq("cuota_id", fee.data.id)
  .is("reversed_at", null)
  .limit(1)
  .single();
if (payment.error) throw payment.error;
const users = await admin.auth.admin.listUsers({ perPage: 1000 });
if (users.error) throw users.error;
const actor = users.data.users.find((item) => item.email === "p05.a.cobranza@example.invalid");
if (!actor) throw new Error("Actor de cobranza demo no disponible.");

const folio = `EC-${payment.data.id.split("-")[0].toUpperCase()}`;
const pdf = new jsPDF({ unit: "pt", format: "letter" });
pdf.setFontSize(18);
pdf.text("Recibo de cuota de mantenimiento — DEMO", 40, 52);
pdf.setFontSize(11);
const lines = [
  ["Folio", folio],
  ["Condominio", condoA.nombre],
  ["Unidad", unit.data.numero],
  ["Periodo", fee.data.periodo],
  ["Monto", `$${Number(payment.data.monto).toFixed(2)}`],
  ["Fecha", payment.data.fecha_pago],
];
let y = 86;
for (const [label, value] of lines) {
  pdf.text(`${label}: ${value}`, 40, y);
  y += 22;
}
const bytes = Buffer.from(pdf.output("arraybuffer"));
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
const path = `${condoA.id}/recibo/p05/${payment.data.id}.pdf`;
const upload = await admin.storage
  .from("condominios-private")
  .upload(path, bytes, { contentType: "application/pdf", upsert: true });
if (upload.error) throw upload.error;
const existing = await admin
  .from("condominio_documentos")
  .select("*")
  .eq("object_path", path)
  .maybeSingle();
if (existing.error) throw existing.error;
let document = existing.data;
if (!document) {
  const inserted = await admin
    .from("condominio_documentos")
    .insert({
      condominio_id: condoA.id,
      unidad_id: unit.data.id,
      categoria: "recibo",
      bucket: "condominios-private",
      object_path: path,
      nombre_original: `Recibo_${folio}_${unit.data.numero}.pdf`,
      mime_type: "application/pdf",
      size_bytes: bytes.length,
      sha256,
      retencion_hasta: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (inserted.error) throw inserted.error;
  document = inserted.data;
}
const linked = await admin
  .from("cuotas_condominio")
  .update({ recibo_documento_id: document.id })
  .eq("id", fee.data.id)
  .eq("condominio_id", condoA.id);
if (linked.error) throw linked.error;
const audit = await admin.rpc("condominio_auditar", {
  p_actor: actor.id,
  p_condominio: condoA.id,
  p_unidad: unit.data.id,
  p_accion: "generar_recibo_demo",
  p_entidad: "condominio_documentos",
  p_entidad_id: document.id,
  p_motivo: "Validación P0.5 sin envío real",
  p_antes: null,
  p_despues: { cuota_id: fee.data.id, folio, sha256 },
  p_request_id: `p05-receipt-${crypto.randomUUID()}`,
});
if (audit.error) throw audit.error;

async function clientFor(scope) {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({
    email: `p05.${scope}.lider_cuenta@example.invalid`,
    password,
  });
  if (login.error) throw login.error;
  return client;
}
const leaderA = await clientFor("a");
const leaderB = await clientFor("b");
const ownDownload = await leaderA.storage.from(document.bucket).download(document.object_path);
const otherDownload = await leaderB.storage.from(document.bucket).download(document.object_path);
if (ownDownload.error || !otherDownload.error) throw new Error("Aislamiento del recibo incorrecto.");

const recipients = [...new Set([
  unit.data.propietario_email,
  unit.data.residente_email,
].filter(Boolean))];
if (!recipients.length || recipients.some((email) => !email.endsWith("@example.invalid"))) {
  throw new Error("Destinatarios demo no están controlados.");
}
const source = await readFile(new URL("../pages/api/enviar-recibo-condominio.js", import.meta.url), "utf8");
if (/emailDestino|pdfBase64/.test(source)) {
  throw new Error("El API acepta destinatario o PDF arbitrario.");
}
if (!/CONDOMINIOS_RECEIPT_BCC/.test(source)) throw new Error("BCC no es configurable.");
if (!/CONDOMINIOS_RECEIPT_SEND_ENABLED/.test(source)) {
  throw new Error("El envío real no está protegido por configuración.");
}

const rateKey = `p05-receipt-provider-${crypto.randomUUID()}`;
const firstLimit = await admin.rpc("condominio_consume_rate_limit", {
  p_key: rateKey,
  p_window_seconds: 60,
  p_max_hits: 1,
});
const secondLimit = await admin.rpc("condominio_consume_rate_limit", {
  p_key: rateKey,
  p_window_seconds: 60,
  p_max_hits: 1,
});
if (firstLimit.error || secondLimit.error || firstLimit.data !== true || secondLimit.data !== false) {
  throw new Error(`Rate limit no rechazó el segundo intento: ${JSON.stringify({
    first: firstLimit.data,
    second: secondLimit.data,
    firstError: firstLimit.error?.code || null,
    secondError: secondLimit.error?.code || null,
    firstMessage: firstLimit.error?.message || null,
    secondMessage: secondLimit.error?.message || null,
  })}`);
}

const resend = new Resend("re_p05_invalid_demo_key");
const providerAttempt = await resend.emails.send({
  from: "P0.5 Demo <onboarding@resend.dev>",
  to: ["delivered@resend.dev"],
  subject: "P0.5 invalid provider test",
  text: "This request must fail because the API key is intentionally invalid.",
});
if (!providerAttempt.error) throw new Error("El proveedor aceptó una credencial deliberadamente inválida.");

await Promise.all([leaderA.auth.signOut(), leaderB.auth.signOut()]);
console.log(JSON.stringify({
  projectRef: config.projectRef,
  folio,
  documentId: document.id,
  sha256,
  privateStorageVerified: true,
  crossTenantAccessRejected: true,
  recipientsResolvedFromDatabase: recipients.length,
  arbitraryRecipientRejectedByContract: true,
  fixedPersonalBccAbsent: true,
  rateLimitVerified: true,
  providerErrorHandled: true,
  realEmailSent: false,
  pending: [
    "Envío real requiere una credencial Resend exclusiva de demo y confirmar que el alias técnico recibe correo.",
    "No existe todavía un endpoint público de verificación de folio o QR.",
  ],
}, null, 2));
