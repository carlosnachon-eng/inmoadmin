import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCondominiosEntry } from "../../lib/server/condominiosEntry.js";
import { validateCondominioUploadFile } from "../../lib/condominiosFiles.js";

const detailSource = fs.readFileSync(new URL("../../pages/condominio/[id].js", import.meta.url), "utf8");
const homeSource = fs.readFileSync(new URL("../../pages/index.js", import.meta.url), "utf8");
const portalSource = fs.readFileSync(new URL("../../pages/condomino.js", import.meta.url), "utf8");

test("gasto acepta ausencia de archivo y valida comprobantes permitidos", () => {
  assert.equal(validateCondominioUploadFile(null), null);
  const valid = { type: "application/pdf", size: 1024, name: "gasto.pdf" };
  assert.equal(validateCondominioUploadFile(valid), valid);
  assert.throws(() => validateCondominioUploadFile({ type: "text/html", size: 100, name: "x.html" }), /PDF, JPG, PNG o WebP/);
  assert.throws(() => validateCondominioUploadFile({ type: "application/pdf", size: 11 * 1024 * 1024, name: "x.pdf" }), /10 MB/);
});

test("la carga del comprobante pertenece a guardarGasto y se limpia sólo después del éxito", () => {
  const generar = detailSource.slice(
    detailSource.indexOf("const generarCuotasPeriodo"),
    detailSource.indexOf("const registrarPagoSeguro"),
  );
  const guardar = detailSource.slice(
    detailSource.indexOf("const guardarGasto"),
    detailSource.indexOf("const reversarGasto"),
  );
  assert.doesNotMatch(generar, /uploadCondominioDocument/);
  assert.match(guardar, /let documento = null/);
  assert.match(guardar, /uploadCondominioDocument/);
  assert.match(guardar, /documento_id: documento\?\.id \|\| null/);
  assert.match(guardar, /notas: formGasto\.notas/);
  assert.match(guardar, /setModalGasto\(false\).*setFormGasto\(emptyGasto\).*setArchivoComprobante\(null\)/s);
  assert.ok(guardar.indexOf("await condominiosApi") < guardar.indexOf("setModalGasto(false)"));
  assert.match(detailSource, /onClose=\{\(\) => \{ setModalGasto\(false\); setArchivoComprobante\(null\); \}\}/);
});

test("errores de Storage o API no ejecutan el bloque de éxito", () => {
  const guardar = detailSource.slice(
    detailSource.indexOf("const guardarGasto"),
    detailSource.indexOf("const reversarGasto"),
  );
  assert.match(guardar, /catch \(error\) \{\s*showToast\(error\.message, false\)/);
  assert.ok(guardar.indexOf("uploadCondominioDocument") < guardar.indexOf("await condominiosApi"));
  assert.ok(guardar.indexOf("await condominiosApi") < guardar.indexOf("showToast(`Gasto registrado"));
});

test("resuelve condómino, multiunidad, interno e interno con unidades sin elevar permisos", () => {
  const portalMembership = { activo: true, unidad_id: "unit-a", rol: "condomino" };
  assert.equal(resolveCondominiosEntry({ profile: null, memberships: [portalMembership] }), "portal");
  assert.equal(resolveCondominiosEntry({
    profile: null,
    memberships: [portalMembership, { ...portalMembership, unidad_id: "unit-b" }],
  }), "portal");
  const internal = { active: true, role_id: "admin", roles: { es_externo: false } };
  assert.equal(resolveCondominiosEntry({ profile: internal, memberships: [] }), "internal");
  assert.equal(resolveCondominiosEntry({ profile: internal, memberships: [portalMembership] }), "internal");
  assert.equal(resolveCondominiosEntry({ profile: null, memberships: [] }), "unassigned");
  assert.equal(resolveCondominiosEntry({
    profile: { active: true, role_id: "condomino", roles: { es_externo: true } },
    memberships: [],
  }), "unassigned");
});

test("la entrada usa el origen del ambiente, evita hardcode productivo y conserva logout", () => {
  assert.match(homeSource, /window\.location\.replace\(`\$\{window\.location\.origin\}\/condomino`\)/);
  assert.doesNotMatch(portalSource, /emailRedirectTo: "https:\/\/app\.emporioinmobiliario/);
  assert.match(portalSource, /`\$\{window\.location\.origin\}\/condomino`/);
  assert.match(portalSource, /supabase\.auth\.signOut/);
  assert.match(portalSource, /unidadesPortal\.length > 1/);
});
