import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const receiptSource = fs.readFileSync(new URL("../../pages/api/enviar-recibo-condominio.js", import.meta.url), "utf8");
const portalSource = fs.readFileSync(new URL("../../pages/condomino.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../../supabase/migrations/202607170001_condominios_p0_security.sql", import.meta.url), "utf8");

test("el API de recibos no acepta destinatario ni PDF del cliente", () => {
  assert.doesNotMatch(receiptSource, /emailDestino|pdfBase64/);
  assert.match(receiptSource, /CONDOMINIOS_RECEIPT_SEND_ENABLED/);
  assert.match(receiptSource, /cuota_id/);
  assert.match(receiptSource, /requireUser/);
  assert.match(receiptSource, /CONDOMINIOS_RECEIPT_BCC/);
});

test("el portal no resuelve identidad por email ni usa URL pública", () => {
  assert.doesNotMatch(portalSource, /\.or\(`propietario_email/);
  assert.doesNotMatch(portalSource, /getPublicUrl/);
  assert.match(portalSource, /\/api\/condominios\/portal/);
});

test("la migración fuerza RLS, revoca escrituras y protege storage", () => {
  for (const table of ["condominios", "unidades_condominio", "cuotas_condominio", "gastos_condominio"]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke insert,update,delete/i);
  assert.match(migration, /'condominios-private'.*false/s);
  assert.match(migration, /condominio_audit_log/);
});
