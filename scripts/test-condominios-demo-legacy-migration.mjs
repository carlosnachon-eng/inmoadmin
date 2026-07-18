import crypto from "node:crypto";
import { jsPDF } from "jspdf";
import { createClient } from "@supabase/supabase-js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "ensayo de comprobantes legados ficticios P0.5",
  writeCapable: true,
});
const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = String(process.env.CONDOMINIOS_DEMO_PASSWORD || "");
const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const legacyBucket = "condominios-legacy-demo-public";
const privateBucket = "condominios-private";

const condos = await admin.from("condominios").select("id,total_unidades").eq("notas", marker);
if (condos.error || condos.data.length !== 2) throw new Error("Tenants demo no disponibles.");
const condoA = condos.data.find((item) => item.total_unidades === 60);
const condoB = condos.data.find((item) => item.total_unidades === 12);
const unitA = await admin
  .from("unidades_condominio")
  .select("id")
  .eq("condominio_id", condoA.id)
  .limit(1)
  .single();
if (unitA.error) throw unitA.error;
const users = await admin.auth.admin.listUsers({ perPage: 1000 });
if (users.error) throw users.error;
const actor = users.data.users.find((item) => item.email === "p05.a.lider_cuenta@example.invalid");
if (!actor) throw new Error("Actor demo no disponible.");

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

const existingBucket = await admin.storage.getBucket(legacyBucket);
if (existingBucket.error) {
  const created = await admin.storage.createBucket(legacyBucket, {
    public: true,
    fileSizeLimit: 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });
  if (created.error) throw created.error;
} else {
  const update = await admin.storage.updateBucket(legacyBucket, {
    public: true,
    fileSizeLimit: 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });
  if (update.error) throw update.error;
}

const pdf = new jsPDF();
pdf.text("COMPROBANTE LEGADO TOTALMENTE FICTICIO — P0.5", 20, 30);
pdf.text(`Tenant demo A: ${condoA.id}`, 20, 45);
const bytes = Buffer.from(pdf.output("arraybuffer"));
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
const legacyPath = `inventario-ficticio/${crypto.randomUUID()}.pdf`;
const privatePath = `${condoA.id}/comprobante_pago/legado-p05/${crypto.randomUUID()}.pdf`;
const uploadedLegacy = await admin.storage
  .from(legacyBucket)
  .upload(legacyPath, bytes, { contentType: "application/pdf", upsert: false });
if (uploadedLegacy.error) throw uploadedLegacy.error;

const inventory = {
  bucket: legacyBucket,
  path: legacyPath,
  condominio_id: condoA.id,
  unidad_id: unitA.data.id,
  size_bytes: bytes.length,
  sha256,
  fictitious: true,
};

async function migrate() {
  const source = await admin.storage.from(legacyBucket).download(legacyPath);
  if (source.error) throw source.error;
  const sourceBytes = Buffer.from(await source.data.arrayBuffer());
  const sourceHash = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceHash !== sha256) throw new Error("Checksum de origen no coincide.");
  const upload = await admin.storage
    .from(privateBucket)
    .upload(privatePath, sourceBytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) throw upload.error;
  const document = await admin
    .from("condominio_documentos")
    .insert({
      condominio_id: condoA.id,
      unidad_id: unitA.data.id,
      categoria: "comprobante_pago",
      bucket: privateBucket,
      object_path: privatePath,
      nombre_original: "p05-comprobante-legado-ficticio.pdf",
      mime_type: "application/pdf",
      size_bytes: sourceBytes.length,
      sha256: sourceHash,
      retencion_hasta: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (document.error) throw document.error;
  const audit = await admin.rpc("condominio_auditar", {
    p_actor: actor.id,
    p_condominio: condoA.id,
    p_unidad: unitA.data.id,
    p_accion: "migrar_legado_demo",
    p_entidad: "condominio_documentos",
    p_entidad_id: document.data.id,
    p_motivo: "Ensayo P0.5 con archivo ficticio",
    p_antes: { bucket: legacyBucket, path: legacyPath, sha256 },
    p_despues: { bucket: privateBucket, path: privatePath, sha256 },
    p_request_id: `p05-legacy-${crypto.randomUUID()}`,
  });
  if (audit.error) throw audit.error;
  return document.data;
}

async function rollback(document) {
  const removal = await admin.storage.from(privateBucket).remove([privatePath]);
  if (removal.error) throw removal.error;
  const deleted = await admin
    .from("condominio_documentos")
    .delete()
    .eq("id", document.id)
    .eq("condominio_id", condoA.id);
  if (deleted.error) throw deleted.error;
  const source = await admin.storage.from(legacyBucket).download(legacyPath);
  if (source.error) throw new Error("Rollback no conservó el original ficticio.");
  const audit = await admin.rpc("condominio_auditar", {
    p_actor: actor.id,
    p_condominio: condoA.id,
    p_unidad: unitA.data.id,
    p_accion: "rollback_legado_demo",
    p_entidad: "condominio_documentos",
    p_entidad_id: null,
    p_motivo: "Ensayo de reversión P0.5",
    p_antes: { bucket: privateBucket, path: privatePath, sha256 },
    p_despues: { bucket: legacyBucket, path: legacyPath, sha256 },
    p_request_id: `p05-legacy-rollback-${crypto.randomUUID()}`,
  });
  if (audit.error) throw audit.error;
}

const firstMigration = await migrate();
const firstA = await leaderA.storage.from(privateBucket).download(privatePath);
const firstB = await leaderB.storage.from(privateBucket).download(privatePath);
if (firstA.error || !firstB.error) throw new Error("Aislamiento del archivo migrado incorrecto.");
await rollback(firstMigration);

const finalMigration = await migrate();
const finalBytes = await leaderA.storage.from(privateBucket).download(privatePath);
if (finalBytes.error) throw finalBytes.error;
const finalHash = crypto
  .createHash("sha256")
  .update(Buffer.from(await finalBytes.data.arrayBuffer()))
  .digest("hex");
if (finalHash !== sha256) throw new Error("Checksum final no coincide.");
const crossTenant = await leaderB.storage.from(privateBucket).download(privatePath);
if (!crossTenant.error) throw new Error("Tenant B descargó el legado de A.");

const publicUrl = admin.storage.from(legacyBucket).getPublicUrl(legacyPath).data.publicUrl;
if (!(await fetch(publicUrl)).ok) throw new Error("Original ficticio temporal no estaba disponible.");
const deleteOriginal = await admin.storage.from(legacyBucket).remove([legacyPath]);
if (deleteOriginal.error) throw deleteOriginal.error;
const deleteBucket = await admin.storage.deleteBucket(legacyBucket);
if (deleteBucket.error) throw deleteBucket.error;

await Promise.all([leaderA.auth.signOut(), leaderB.auth.signOut()]);
console.log(JSON.stringify({
  projectRef: config.projectRef,
  inventory,
  rollbackVerified: true,
  repeatedMigrationVerified: true,
  finalDocumentId: finalMigration.id,
  sourceChecksum: sha256,
  finalChecksum: finalHash,
  crossTenantAccessRejected: true,
  fictitiousPublicOriginalRemoved: true,
  productionStorageAccessed: false,
}, null, 2));
