import { createClient } from "@supabase/supabase-js";
import { validateDocumentMetadata } from "../lib/server/condominiosValidation.js";
import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

const config = validateDemoEnvironment(process.env, {
  operation: "pruebas Storage P0.5",
  writeCapable: false,
});
const password = String(process.env.CONDOMINIOS_DEMO_PASSWORD || "");
const admin = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(config.url, config.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

const marker = "P0.5 DEMO — DATOS TOTALMENTE FICTICIOS";
const condos = await admin
  .from("condominios")
  .select("id,total_unidades")
  .eq("notas", marker);
if (condos.error || condos.data.length !== 2) throw new Error("Tenants A/B no disponibles.");
const condoA = condos.data.find((item) => item.total_unidades === 60);
const condoB = condos.data.find((item) => item.total_unidades === 12);
const docs = await admin
  .from("condominio_documentos")
  .select("id,condominio_id,bucket,object_path,nombre_original,mime_type,size_bytes")
  .in("condominio_id", [condoA.id, condoB.id]);
if (docs.error) throw docs.error;
const docA = docs.data.find((item) => item.condominio_id === condoA.id);
const docB = docs.data.find((item) => item.condominio_id === condoB.id);
if (!docA || !docB) throw new Error("Documentos A/B no disponibles.");

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

await check("1. bucket configurado como privado", async () => {
  const response = await admin.storage.getBucket("condominios-private");
  assert(!response.error && response.data.public === false, "bucket público o no disponible");
});

await check("2. anónimo no descarga documento A", async () => {
  const response = await anon.storage.from(docA.bucket).download(docA.object_path);
  assert(Boolean(response.error), "descarga anónima permitida");
});

await check("3. líder A descarga documento A", async () => {
  const response = await leaderA.storage.from(docA.bucket).download(docA.object_path);
  assert(!response.error && (await response.data.arrayBuffer()).byteLength > 0, "A no descargó A");
});

await check("4. líder A no descarga documento B", async () => {
  const response = await leaderA.storage.from(docB.bucket).download(docB.object_path);
  assert(Boolean(response.error), "A descargó B");
});

await check("5. líder B descarga documento B", async () => {
  const response = await leaderB.storage.from(docB.bucket).download(docB.object_path);
  assert(!response.error && (await response.data.arrayBuffer()).byteLength > 0, "B no descargó B");
});

await check("6. líder B no descarga documento A", async () => {
  const response = await leaderB.storage.from(docA.bucket).download(docA.object_path);
  assert(Boolean(response.error), "B descargó A");
});

await check("7. URL pública convencional no entrega el archivo", async () => {
  const publicUrl = admin.storage.from(docA.bucket).getPublicUrl(docA.object_path).data.publicUrl;
  const response = await fetch(publicUrl, { redirect: "manual" });
  assert(!response.ok, `URL pública respondió ${response.status}`);
});

let signedUrl;
await check("8. URL firmada corta funciona inicialmente", async () => {
  const response = await admin.storage.from(docA.bucket).createSignedUrl(docA.object_path, 2);
  assert(!response.error && response.data?.signedUrl, "no se creó firma");
  signedUrl = response.data.signedUrl;
  const fetchResponse = await fetch(signedUrl);
  assert(fetchResponse.ok && (await fetchResponse.arrayBuffer()).byteLength > 0, "firma no descargó");
});

await new Promise((resolve) => setTimeout(resolve, 3_000));
await check("9. URL firmada realmente expira", async () => {
  const response = await fetch(signedUrl, { redirect: "manual" });
  assert(!response.ok, `firma expirada respondió ${response.status}`);
});

await check("10. nombre con traversal es rechazado", async () => {
  let rejected = false;
  try {
    validateDocumentMetadata({
      mimeType: "application/pdf",
      sizeBytes: 100,
      name: "../../otro-tenant.pdf",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "nombre malicioso aceptado");
});

await check("11. tipo ejecutable es rechazado", async () => {
  let rejected = false;
  try {
    validateDocumentMetadata({
      mimeType: "text/html",
      sizeBytes: 100,
      name: "prueba.html",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "tipo no permitido aceptado");
});

await check("12. todas las rutas físicas comienzan con su tenant", async () => {
  assert(
    docs.data.every((item) => item.object_path.startsWith(`${item.condominio_id}/`)),
    "ruta fuera del tenant",
  );
});

await Promise.all([leaderA.auth.signOut(), leaderB.auth.signOut()]);
const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({
  projectRef: config.projectRef,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  documentsChecked: docs.data.length,
  results,
}, null, 2));
if (failed.length) process.exitCode = 1;
