import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
const confirmationBlock = ui.slice(ui.indexOf("const runExactPhoneIdentityConfirmation"), ui.indexOf("const reviewIdentity"));

test("la acción 7/7 sólo se muestra al admin activo", () => {
  assert.match(ui, /identityPreflightAuthorized = profile\?\.active && profile\.role_id === "admin"/);
  assert.match(ui, /\{identityPreflightAuthorized && <details[\s\S]*Confirmación exact_phone_unique 7\/7/);
});

test("exige confirmación explícita y realiza como máximo una petición por carga", () => {
  assert.match(confirmationBlock, /window\.confirm\("Esta acción revalidará y confirmará exactamente las 7 referencias/);
  assert.match(confirmationBlock, /identityConfirmationBusy \|\| identityConfirmationAttempted/);
  assert.ok(confirmationBlock.indexOf("setIdentityConfirmationAttempted(true)") < confirmationBlock.indexOf('fetch("/api/operaciones/shadow-exact-phone-confirmation"'));
  assert.equal((confirmationBlock.match(/fetch\("\/api\/operaciones\/shadow-exact-phone-confirmation"/g) || []).length, 1);
});

test("usa sesión fresca y no expone referencias, tokens ni secretos en el payload", () => {
  assert.match(confirmationBlock, /await supabase\.auth\.getSession\(\)/);
  assert.match(confirmationBlock, /Authorization: `Bearer \$\{currentSession\.access_token\}`/);
  assert.match(confirmationBlock, /body: JSON\.stringify\(\{\}\)/);
  assert.doesNotMatch(confirmationBlock, /EXACT_PHONE_VALIDATED_CANDIDATE_REFS|SUPABASE_SERVICE_ROLE_KEY|RESPOND_IO_TOKEN/);
});

test("sesión ausente o expirada cierra antes del POST y no hay retry automático", () => {
  assert.match(confirmationBlock, /sessionError \|\| !currentSession\?\.access_token \|\| sessionExpired/);
  assert.ok(confirmationBlock.indexOf("return;") < confirmationBlock.indexOf('fetch("/api/operaciones/shadow-exact-phone-confirmation"'));
  assert.doesNotMatch(confirmationBlock, /setTimeout|setInterval|retry|while\s*\(/i);
});

test("la UI presenta un resultado individual y sanitizado", () => {
  const start = ui.indexOf("Confirmación exact_phone_unique 7/7");
  const renderedConfirmation = ui.slice(start, ui.indexOf("</details>}", start));
  assert.match(ui, /identityConfirmation\.results\.map/);
  assert.match(ui, /item\.reference/);
  assert.match(ui, /item\.status/);
  assert.match(ui, /item\.reason/);
  assert.doesNotMatch(renderedConfirmation, /digest|respond_contact_id|client_identity_id/i);
});
