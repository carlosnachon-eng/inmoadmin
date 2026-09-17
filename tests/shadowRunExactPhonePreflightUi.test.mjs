import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
const start = ui.indexOf("const runExactPhoneRunPreflight");
const end = ui.indexOf("const reviewIdentity", start);
const action = ui.slice(start, end);
const renderStart = ui.indexOf("Preflight read-only de runs 4/4");
const render = ui.slice(renderStart, ui.indexOf("</details>}", renderStart));

test("admin activo ve la acción y el servidor conserva la autorización canónica", () => {
  assert.match(ui, /identityPreflightAuthorized = profile\?\.active && profile\.role_id === "admin"/);
  assert.match(ui, /\{identityPreflightAuthorized && <details[\s\S]*Preflight read-only de runs 4\/4/);
  const endpoint = fs.readFileSync(new URL("../lib/shadow/runExactPhonePreflightApi.js", import.meta.url), "utf8");
  assert.match(endpoint, /!actor \|\| actor\.role_id !== "admin"/);
});

test("usa exclusivamente la sesión fresca y el token rotado antes del POST", () => {
  assert.match(action, /await supabase\.auth\.getSession\(\)/);
  assert.match(action, /Authorization: `Bearer \$\{currentSession\.access_token\}`/);
  assert.doesNotMatch(action, /Bearer \$\{session\.access_token\}/);
  assert.ok(action.indexOf("await supabase.auth.getSession()") < action.indexOf('fetch("/api/operaciones/shadow-run-exact-phone-preflight"'));
});

test("sesion ausente o expirada produce cero POST", () => {
  assert.match(action, /sessionError \|\| !currentSession\?\.access_token \|\| sessionExpired/);
  assert.match(action, /Number\(currentSession\?\.expires_at \|\| 0\) <= Math\.floor\(Date\.now\(\) \/ 1000\)/);
  assert.ok(action.indexOf("return;") < action.indexOf('fetch("/api/operaciones/shadow-run-exact-phone-preflight"'));
});

test("hace una sola peticion sin retry y no acepta IDs del cliente", () => {
  assert.match(action, /runIdentityPreflightBusy \|\| runIdentityPreflightAttempted/);
  assert.ok(action.indexOf("setRunIdentityPreflightAttempted(true)") < action.indexOf('fetch("/api/operaciones/shadow-run-exact-phone-preflight"'));
  assert.equal((action.match(/fetch\("\/api\/operaciones\/shadow-run-exact-phone-preflight"/g) || []).length, 1);
  assert.match(action, /body: JSON\.stringify\(\{\}\)/);
  assert.doesNotMatch(action, /runIds|references|RUN_EXACT_PHONE_PREFLIGHT_REFS/);
  assert.doesNotMatch(action, /setTimeout|setInterval|retry|while\s*\(/i);
});

test("la cohorte 4/4 permanece fija server-side y el flujo es read-only", () => {
  const refs = fs.readFileSync(new URL("../lib/shadow/runExactPhonePreflightRefs.js", import.meta.url), "utf8");
  const endpoint = fs.readFileSync(new URL("../pages/api/operaciones/shadow-run-exact-phone-preflight.js", import.meta.url), "utf8");
  const core = fs.readFileSync(new URL("../lib/shadow/runExactPhonePreflight.js", import.meta.url), "utf8");
  assert.equal((refs.match(/"[0-9a-f]{12}"/g) || []).length, 4);
  assert.doesNotMatch(endpoint + core, /\.from\([^\n]+\)\.(?:insert|update|delete|upsert)\(|\.rpc\(/);
});

test("renderiza sólo el resultado sanitizado requerido", () => {
  for (const field of ["item.run", "item.exact_phone_unique", "item.confirmable", "item.blocker", "item.role", "item.property_relationship_resolved", "item.contract_current"]) assert.match(render, new RegExp(field.replace(".", "\\.")));
  assert.doesNotMatch(render, /phone_digest|respond_contact_id|client_identity_id|service_role/i);
});
