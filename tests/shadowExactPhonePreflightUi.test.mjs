import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createExactPhonePreflightHandler,
  sanitizeExactPhonePreflightResults,
  validateCertifiedExactPhoneCohort,
} from "../lib/shadow/exactPhonePreflightApi.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "../lib/shadow/exactPhoneValidatedRefs.js";

const responseRecorder = () => ({
  statusCode: null,
  body: null,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const request = (references = EXACT_PHONE_VALIDATED_CANDIDATE_REFS) => ({
  method: "POST",
  headers: { origin: "https://inmoadmin.example", host: "inmoadmin.example" },
  body: { references },
});

test.beforeEach(() => { process.env.SHADOW_IDENTITY_BRIDGE_ENABLED = "true"; });

test("invalid session is rejected before evaluator access", async () => {
  let evaluated = 0;
  const handler = createExactPhonePreflightHandler({ authorize: async () => null, isSameOrigin: () => true, evaluate: async () => { evaluated += 1; } });
  const res = responseRecorder();
  await handler(request(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "not_authorized");
  assert.equal(evaluated, 0);
});

test("non-admin role is rejected before evaluator access", async () => {
  let adminClientCreated = 0;
  const handler = createExactPhonePreflightHandler({ authorize: async () => ({ role_id: "coord_operaciones" }), isSameOrigin: () => true, createAdminClient: () => { adminClientCreated += 1; } });
  const res = responseRecorder();
  await handler(request(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "admin_required");
  assert.equal(adminClientCreated, 0);
});

test("same-origin is mandatory", async () => {
  const handler = createExactPhonePreflightHandler({ authorize: async () => ({ role_id: "admin" }), isSameOrigin: () => false });
  const res = responseRecorder();
  await handler(request(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "invalid_origin");
});

test("only the complete certified 7/7 cohort is accepted", () => {
  assert.deepEqual(validateCertifiedExactPhoneCohort([...EXACT_PHONE_VALIDATED_CANDIDATE_REFS].reverse()), EXACT_PHONE_VALIDATED_CANDIDATE_REFS);
  assert.throws(() => validateCertifiedExactPhoneCohort(EXACT_PHONE_VALIDATED_CANDIDATE_REFS.slice(0, 6)));
  assert.throws(() => validateCertifiedExactPhoneCohort([...EXACT_PHONE_VALIDATED_CANDIDATE_REFS.slice(0, 6), "aaaaaaaaaaaa"]));
});

test("successful response exposes only the sanitized allowlist and performs one evaluation", async () => {
  let evaluations = 0;
  const raw = EXACT_PHONE_VALIDATED_CANDIDATE_REFS.map((candidateRef, index) => ({
    candidateRef,
    confirmable: index !== 6,
    reason: index === 6 ? "ambiguous_property_context" : null,
    conflict: false,
    role: index % 2 ? "tenant" : "owner",
    propertyResolved: true,
    propertyAmbiguous: index === 6,
    ambiguous: index === 6,
    contractCurrent: true,
    respond_contact_id: "must-not-cross",
    phoneDigestMatches: true,
  }));
  const handler = createExactPhonePreflightHandler({
    authorize: async () => ({ role_id: "admin" }),
    isSameOrigin: () => true,
    createAdminClient: () => Object.freeze({ readOnly: true }),
    evaluate: async (_client, options) => { evaluations += 1; assert.deepEqual(options.references, EXACT_PHONE_VALIDATED_CANDIDATE_REFS); return raw; },
  });
  const res = responseRecorder();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(evaluations, 1);
  assert.equal(res.body.evaluated, 7);
  const allowed = ["conflict", "current_role", "property_relationship_current_unambiguous", "reason", "reference", "still_confirmable"];
  for (const item of res.body.results) assert.deepEqual(Object.keys(item).sort(), allowed);
  assert.equal(JSON.stringify(res.body).includes("must-not-cross"), false);
});

test("sanitizer fail-closes tenant relationship without a current contract", () => {
  const [result] = sanitizeExactPhonePreflightResults([{ candidateRef: "41e6ed66d3d1", confirmable: false, role: "tenant", propertyResolved: true, contractCurrent: false }]);
  assert.equal(result.property_relationship_current_unambiguous, false);
});

test("endpoint and UI remain read-only and the UI sends exactly the certified references", () => {
  const endpoint = fs.readFileSync(new URL("../pages/api/operaciones/shadow-exact-phone-preflight.js", import.meta.url), "utf8");
  const endpointCore = fs.readFileSync(new URL("../lib/shadow/exactPhonePreflightApi.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.doesNotMatch(endpoint + endpointCore, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  assert.match(endpointCore, /req\.method !== "POST"/);
  assert.match(endpointCore, /authorize\(req\)/);
  assert.match(endpointCore, /isSameOrigin\(req\)/);
  assert.match(ui, /Ejecutar preflight identidad 7\/7/);
  assert.match(ui, /identityPreflightAuthorized = profile\?\.active && profile\.role_id === "admin"/);
  assert.match(ui, /references: EXACT_PHONE_VALIDATED_CANDIDATE_REFS/);
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY|RESPOND_IO_TOKEN/);
});
