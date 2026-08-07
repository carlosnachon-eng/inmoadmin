import crypto from "crypto";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  enforceRateLimit,
  HttpError,
  requestId,
  requireCondominioPermission,
  sendApiError,
} from "../../../../lib/server/condominiosAuth";
import { asIdempotencyKey, asUuid } from "../../../../lib/server/condominiosValidation";
import { toCsv } from "../../../../lib/server/csv";
import { PRIVATE_BUCKET, signedDocumentUrl } from "../../../../lib/server/condominiosStorage";
import {
  completeIdempotency,
  releaseIdempotency,
  reserveIdempotency,
} from "../../../../lib/server/condominiosIdempotency";

export const config = { api: { bodyParser: { sizeLimit: "16kb" }, responseLimit: false } };

const EXPORT_SPECS = [
  ["unidades", "unidades_condominio", [
    "id","numero","piso","propietario_nombre","propietario_email","propietario_telefono",
    "residente_nombre","residente_email","residente_telefono","residente_es_propietario","notas","activo",
  ]],
  ["cuotas", "cuotas_condominio", [
    "id","unidad_id","periodo","monto","status","fecha_vencimiento","fecha_pago","created_at",
  ]],
  ["pagos", "condominio_pagos", [
    "id","unidad_id","cuota_id","periodo","monto","fecha_pago","metodo","referencia","notas",
    "reversed_at","reversal_reason","created_at",
  ]],
  ["gastos", "gastos_condominio", [
    "id","concepto","categoria","monto","fecha","notas","reversed_at","reversal_reason","created_at",
  ]],
  ["saldos_iniciales", "condominio_saldos_iniciales", [
    "id","unidad_id","fecha_corte","monto","motivo","created_at",
  ]],
  ["periodos", "condominio_periodos", [
    "id","periodo","estado","cerrado_at","reabierto_at","motivo_reapertura","created_at",
  ]],
  ["auditoria", "condominio_audit_log", [
    "id","occurred_at","actor_id","unidad_id","accion","entidad","entidad_id","motivo","request_id",
  ]],
];

function safeJson(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function renderSummaryPdf(condominio, counts, generatedAt) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(19);
  doc.text("Expediente de administración condominal", 40, 48);
  doc.setFontSize(12);
  doc.text(String(condominio.nombre || "Condominio"), 40, 70);
  doc.setFontSize(9);
  doc.text(`Generado: ${generatedAt}`, 40, 88);
  autoTable(doc, {
    startY: 112,
    head: [["Sección", "Registros"]],
    body: Object.entries(counts).map(([name, count]) => [name, String(count)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [31, 41, 55] },
  });
  doc.setFontSize(8);
  doc.text(
    "Este resumen no sustituye estados financieros conciliados. El ZIP contiene los datos y documentos autorizados.",
    40,
    doc.lastAutoTable.finalY + 28,
    { maxWidth: 520 },
  );
  return Buffer.from(doc.output("arraybuffer"));
}

async function loadTenantData(supabase, condominioId) {
  const { data: condominio, error: condoError } = await supabase
    .from("condominios")
    .select("*")
    .eq("id", condominioId)
    .single();
  if (condoError || !condominio) throw new HttpError(404, "Condominio no encontrado");

  const output = {};
  for (const [name, table, columns] of EXPORT_SPECS) {
    const { data, error } = await supabase
      .from(table)
      .select(columns.join(","))
      .eq("condominio_id", condominioId)
      .limit(10000);
    if (error) throw new Error(`No se pudo exportar ${name}: ${error.message}`);
    output[name] = { rows: data || [], columns };
  }
  const { data: documents, error: docsError } = await supabase
    .from("condominio_documentos")
    .select("*")
    .eq("condominio_id", condominioId)
    .limit(10000);
  if (docsError) throw new Error(docsError.message);
  return { condominio, output, documents: documents || [] };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  let context;
  let reservation;
  let key;
  const condominioId = req.query.id;
  try {
    asUuid(condominioId, "condominio_id");
    context = await requireCondominioPermission(req, condominioId, "exportar");
    await enforceRateLimit(context.supabase, `export:${context.user.id}:${condominioId}`, 3, 3600);
    key = asIdempotencyKey(req);
    reservation = await reserveIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      payload: { action: "exportar", condominio_id: condominioId },
    });
    if (reservation.cached) {
      const { data: document } = await context.supabase
        .from("condominio_documentos")
        .select("*")
        .eq("id", reservation.response.documento_id)
        .eq("condominio_id", condominioId)
        .single();
      return res.status(200).json({ ok: true, cached: true, data: await signedDocumentUrl(context.supabase, document) });
    }

    const { data: exportRecord, error: exportError } = await context.supabase
      .from("condominio_exportaciones")
      .insert({ condominio_id: condominioId, created_by: context.user.id })
      .select("*")
      .single();
    if (exportError) throw new Error(exportError.message);

    const generatedAt = new Date().toISOString();
    const { condominio, output, documents } = await loadTenantData(context.supabase, condominioId);
    const zip = new JSZip();
    const counts = {};
    for (const [name, { rows, columns }] of Object.entries(output)) {
      counts[name] = rows.length;
      zip.file(`datos/${name}.csv`, `\uFEFF${toCsv(rows, columns)}`);
    }
    zip.file("datos/condominio.json", safeJson(condominio));
    zip.file("resumen.pdf", renderSummaryPdf(condominio, counts, generatedAt));

    const documentIndex = [];
    for (const document of documents) {
      if (document.categoria === "exportacion") continue;
      const { data, error } = await context.supabase.storage
        .from(document.bucket)
        .download(document.object_path);
      if (error) {
        documentIndex.push({ id: document.id, nombre: document.nombre_original, incluido: false, error: "no disponible" });
        continue;
      }
      const bytes = Buffer.from(await data.arrayBuffer());
      const safeName = String(document.nombre_original || document.id).replace(/[^a-zA-Z0-9._-]/g, "_");
      zip.file(`documentos/${document.id}_${safeName}`, bytes);
      documentIndex.push({
        id: document.id,
        nombre: document.nombre_original,
        categoria: document.categoria,
        incluido: true,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
    }
    zip.file("documentos/indice.json", safeJson(documentIndex));
    zip.file("manifest.json", safeJson({
      version: 1,
      condominio_id: condominioId,
      generado_en: generatedAt,
      conteos: counts,
      documentos: documentIndex.length,
    }));

    const archive = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    if (archive.length > 100 * 1024 * 1024) {
      throw new HttpError(413, "El expediente supera 100 MB; debe exportarse por periodos");
    }
    const hash = crypto.createHash("sha256").update(archive).digest("hex");
    const path = `${condominioId}/exportacion/${generatedAt.slice(0, 10)}/${exportRecord.id}.zip`;
    const { error: uploadError } = await context.supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(path, archive, { contentType: "application/zip", upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: document, error: documentError } = await context.supabase
      .from("condominio_documentos")
      .insert({
        condominio_id: condominioId,
        categoria: "exportacion",
        bucket: PRIVATE_BUCKET,
        object_path: path,
        nombre_original: `expediente-${condominioId}-${generatedAt.slice(0, 10)}.zip`,
        mime_type: "application/zip",
        size_bytes: archive.length,
        sha256: hash,
        retencion_hasta: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (documentError) throw new Error(documentError.message);

    const { error: completeError } = await context.supabase
      .from("condominio_exportaciones")
      .update({ estado: "lista", documento_id: document.id, sha256: hash, completed_at: new Date().toISOString() })
      .eq("id", exportRecord.id)
      .eq("condominio_id", condominioId);
    if (completeError) throw new Error(completeError.message);

    await context.supabase.rpc("condominio_auditar", {
      p_actor: context.user.id,
      p_condominio: condominioId,
      p_unidad: null,
      p_accion: "exportar",
      p_entidad: "condominio_exportaciones",
      p_entidad_id: exportRecord.id,
      p_motivo: null,
      p_antes: null,
      p_despues: { documento_id: document.id, sha256: hash, size_bytes: archive.length, counts },
      p_request_id: requestId(req),
    });
    const response = { exportacion_id: exportRecord.id, documento_id: document.id, sha256: hash };
    await completeIdempotency({
      supabase: context.supabase,
      actorId: context.user.id,
      condominioId,
      key,
      response,
    });
    return res.status(201).json({ ok: true, cached: false, data: { ...response, ...(await signedDocumentUrl(context.supabase, document)) } });
  } catch (error) {
    if (context && key && !reservation?.cached) {
      await releaseIdempotency({ supabase: context.supabase, actorId: context.user.id, condominioId, key });
    }
    return sendApiError(res, error);
  }
}
