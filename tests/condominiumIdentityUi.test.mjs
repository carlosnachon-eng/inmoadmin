import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { requestCondominiumIdentityReview } from "../lib/shadow/condominiumIdentityClient.js";
import { condoActor, fixtureUuid } from "./helpers/condominiumIdentityFixture.mjs";

const require = createRequire(import.meta.url);
// Execute the actual JSX/event handlers with deterministic hooks; no DOM, network or secrets.
const source = fs.readFileSync(new URL("../components/CondominiumIdentityReview.js", import.meta.url), "utf8");
const compiled = require("next/dist/build/swc").transformSync(source, {
  jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" },
}).code;
function componentHarness(fetchImpl, profile = condoActor) {
  const state = []; let cursor = 0, token = "synthetic-initial", valid = true;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react") return hooks;
    if (name === "../lib/shadow/condominiumIdentityClient") return { requestCondominiumIdentityReview: (args) => requestCondominiumIdentityReview({ ...args, fetchImpl }) };
    return require(name);
  }, module, module.exports);
  const supabase = { auth: { getSession: async () => ({ data: { session: valid ? { user: { id: profile.id }, access_token: token, expires_at: 9999999999 } : null } }) } };
  return { render() { cursor = 0; return module.exports.default({ supabase, profile }); }, rotate() { token = "synthetic-rotated"; }, expire() { valid = false; } };
}
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const button = (tree, label) => nodes(tree).find((n) => n.type === "button" && n.props.children === label);
const fixtureCandidate = { candidateId: fixtureUuid(301), candidateRef: "candidate-synthetic", contactRef: "contact-synthetic", unitRef: "unit-synthetic", condominiumRef: "condo-synthetic", status: "requires_review" };
const listing = { ok: true, capabilities: { prepare: true, review: true }, units: [], candidates: [fixtureCandidate] };
const response = (body) => ({ ok: true, json: async () => body });

test("UI real: admin, revisión explícita, sesión rotada, una sola petición y resultado visible", async () => {
  const calls = []; let release;
  const ui = componentHarness(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    if (body.action === "condominium_list") return response(listing);
    await new Promise((resolve) => { release = resolve; });
    return response({ ok: true, result: { status: "confirmed", candidateRef: fixtureCandidate.candidateRef, unitRef: fixtureCandidate.unitRef } });
  });
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { confirm: () => false };
    await button(ui.render(), "Consultar unidades y candidatos").props.onClick();
    let tree = ui.render();
    assert.equal(button(tree, "Aprobar relación e identidad").props.disabled, true);
    const checkbox = nodes(tree).find((n) => n.type === "input" && n.props.type === "checkbox" && n.props.checked === false && n.props.onChange.toString().includes("candidateId"));
    checkbox.props.onChange({ target: { checked: true } }); tree = ui.render();
    await button(tree, "Aprobar relación e identidad").props.onClick(); assert.equal(calls.length, 1);
    globalThis.window.confirm = () => true; ui.rotate();
    const submit = button(tree, "Aprobar relación e identidad").props.onClick;
    const first = submit(); const duplicate = submit();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 2); assert.equal(calls[1].options.headers.Authorization, "Bearer synthetic-rotated");
    assert.deepEqual(calls[1].body, { action: "condominium_confirm", candidateId: fixtureCandidate.candidateId, ownershipReviewed: true });
    release(); await Promise.all([first, duplicate]);
    const status = nodes(ui.render()).find((n) => n.props?.role === "status"); assert.ok(JSON.stringify(status).includes("confirmed"));
    assert.equal(calls.length, 2);
  } finally { globalThis.window = previousWindow; }
});

test("UI real: no-admin no ve acción; sesión expirada cero POST y sin retry", async () => {
  let calls = 0; const transport = async () => { calls++; return response(listing); };
  assert.equal(componentHarness(transport, { ...condoActor, role_id: "coord_operaciones" }).render(), null);
  assert.equal(componentHarness(transport, { ...condoActor, active: false }).render(), null);
  const ui = componentHarness(transport); ui.expire();
  await button(ui.render(), "Consultar unidades y candidatos").props.onClick();
  assert.equal(calls, 0); assert.ok(JSON.stringify(ui.render()).includes("fresh_session_required"));
});

test("healthcheck UI: opaque ref, fresh token, one read-only POST without listing/confirming or retry", async () => {
  const calls = []; let release;
  const ui = componentHarness(async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    await new Promise((resolve) => { release = resolve; });
    return response({ ok: true, result: { candidateRef: "aabbccddeeff", resolved: true, identityDomain: "condominium", roles: ["owner"],
      linkSource: "condominium_owner_admin_review", unitRef: "112233445566", condominiumRef: "665544332211", ambiguousUnitContext: false } });
  });
  assert.equal(button(ui.render(), "Comprobar resolver pre-3A").props.disabled, true);
  const input = nodes(ui.render()).find((n) => n.props?.["aria-label"] === "Referencia opaca del candidato confirmado");
  input.props.onChange({ target: { value: "aabbccddeeff" } }); ui.rotate();
  const submit = button(ui.render(), "Comprobar resolver pre-3A").props.onClick;
  const first = submit(); const duplicate = submit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-rotated");
  assert.deepEqual(calls[0].body, { action: "condominium_resolver_check", candidateRef: "aabbccddeeff" });
  release(); await Promise.all([first, duplicate]);
  const status = nodes(ui.render()).find((n) => n.props?.["aria-label"] === "Resultado healthcheck pre-3A");
  assert.equal(JSON.parse(status.props.children).resolved, true); assert.equal(calls.length, 1);
  assert.equal(button(ui.render(), "Aprobar relación e identidad"), undefined);
});

test("healthcheck UI: expired session -> zero POST, request error -> no retry", async () => {
  let calls = 0;
  const ui = componentHarness(async () => { calls++; return { ok: false, json: async () => ({ ok: false, error: "candidate_not_confirmed" }) }; });
  const setRef = () => nodes(ui.render()).find((n) => n.props?.["aria-label"] === "Referencia opaca del candidato confirmado").props.onChange({ target: { value: "aabbccddeeff" } });
  setRef();
  await button(ui.render(), "Comprobar resolver pre-3A").props.onClick();
  assert.equal(calls, 1); assert.ok(JSON.stringify(ui.render()).includes("candidate_not_confirmed"));
  ui.expire(); setRef();
  await button(ui.render(), "Comprobar resolver pre-3A").props.onClick();
  assert.equal(calls, 1); assert.ok(JSON.stringify(ui.render()).includes("fresh_session_required"));
});
