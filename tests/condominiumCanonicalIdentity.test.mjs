import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { reviewCondominiumIdentity, resolveApprovedCondominiumIdentity, loadCondominiumIdentityBefore3A, listCondominiumIdentityReview } from "../lib/shadow/condominiumIdentity.js";
import { createCondominiumIdentityReviewHandler } from "../lib/shadow/condominiumIdentityApi.js";
import { requestCondominiumIdentityReview } from "../lib/shadow/condominiumIdentityClient.js";
import { resolveConfirmedContactIdentity, reviewIdentityLink } from "../lib/shadow/identityBridge.js";
import { invokeShadowPhase3A } from "../lib/shadow/ai/phase3AGateway.js";
import { buildShadowRunIdentityObservability } from "../lib/shadow/runIdentityObservability.js";
import { buildShadowOperationalResolution } from "../lib/shadow/ai/operationalResolution.js";
import { buildConversationAction } from "../lib/shadow/ai/conversationAction.js";
import { EXACT_PHONE_VALIDATED_CANDIDATE_REFS } from "../lib/shadow/exactPhoneValidatedRefs.js";
import { condominiumCases, condoActor, condoEnv, fixtureUuid, fixtureDigest, memoryAdmin, confirmedCondoTables } from "./helpers/condominiumIdentityFixture.mjs";

test("tres fixtures de aceptación conservan unidad/condominio, nunca propertyId de Rentas", async () => {
  for (const c of condominiumCases.slice(0, 3)) {
    const tables = confirmedCondoTables(); tables.respond_identity_links[0].respond_contact_id = c.contactId;
    tables.client_identities[0].phone_digest = fixtureDigest(c.phone);
    tables.unidades_condominio[0] = { ...tables.unidades_condominio[0], id: c.unitId, propietario_telefono: c.phone };
    tables.client_source_links[0].source_id = c.unitId;
    const admin = memoryAdmin(tables);
    const result = await resolveConfirmedContactIdentity(admin, c.contactId, { audit: false });
    assert.equal(result.resolved, true); assert.deepEqual(result.roles, ["owner"]);
    assert.equal(result.selectedUnitId, c.unitId); assert.deepEqual(result.properties, []); assert.deepEqual(result.contracts, []);
    assert.ok(!admin.reads.includes("contracts") && !admin.reads.includes("properties"));
  }
});

test("cuarto run sin asociación no obtiene identidad ni unidad inventada", async () => {
  const result = await loadCondominiumIdentityBefore3A(memoryAdmin(), condominiumCases[3].contactId);
  assert.equal(result, null);
});

test("candidato/revocado/conflict nunca produce identidad resuelta", async () => {
  for (const status of ["candidate", "revoked", "conflict"]) {
    const result = await loadCondominiumIdentityBefore3A(memoryAdmin(confirmedCondoTables({ status })), condominiumCases[0].contactId);
    assert.equal(result.result[0].resolved, false); assert.equal(result.result.length, 1);
    const [observed] = buildShadowRunIdentityObservability({ runs: [{ id: "synthetic", tool_results_json: [result] }] });
    assert.equal(observed.attribution, "unattributed"); assert.equal(observed.identityDomain, "condominium");
    assert.equal(observed.resolutionSource, "condominium_owner_admin_review");
  }
});

test("3B real conserva guarda financiera y no convierte unidad en propiedad de renta", async () => {
  const tools = [await loadCondominiumIdentityBefore3A(memoryAdmin(confirmedCondoTables()), condominiumCases[0].contactId)];
  for (const intent of ["pago_renta", "servicio", "mantenimiento", "no_determinado"]) {
    const envelope = { sanitizedText: "Comparto comprobante de pago para revisión.", providerMetadata: { respondContactId: condominiumCases[0].contactId, authorRole: "contact" } };
    const decision = { intent, confidence: 0.99, resolvedEntities: [], requiresHuman: false };
    const resolution = buildShadowOperationalResolution({ decision, envelope, tools });
    assert.equal(resolution.requires_human, true);
    assert.notEqual(resolution.human_reason, "insufficient_identity_context");
    assert.equal(resolution.identified_entities.length, 0);
    const action = buildConversationAction({ resolution, decision });
    assert.equal(action.requires_human, true); assert.equal(action.auto_send_eligible, false);
  }
});

test("las siete referencias históricas conservan exactamente su resolución de Rentas", async () => {
  assert.equal(EXACT_PHONE_VALIDATED_CANDIDATE_REFS.length, 7);
  for (const [i, ref] of EXACT_PHONE_VALIDATED_CANDIDATE_REFS.entries()) {
    const tables = { respond_identity_links: [{ id: fixtureUuid(400 + i), client_identity_id: fixtureUuid(500 + i), respond_contact_id: `synthetic-legacy-${ref}`, link_source: "exact_phone_unique", link_status: "confirmed" }],
      contracts: [], properties: [{ id: fixtureUuid(600 + i), owner_client_id: fixtureUuid(500 + i), status: "ocupada" }] };
    const admin = memoryAdmin(tables);
    assert.equal(await loadCondominiumIdentityBefore3A(admin, `synthetic-legacy-${ref}`), null);
    const identity = await resolveConfirmedContactIdentity(admin, `synthetic-legacy-${ref}`, { audit: false });
    assert.equal(identity.resolved, true); assert.equal(identity.linkSource, "exact_phone_unique");
    assert.equal(identity.properties[0].id, fixtureUuid(600 + i)); assert.equal(identity.identityDomain, undefined);
    assert.ok(!admin.reads.includes("unidades_condominio"));
    let context;
    const legacyIdentity = { entityType:"contact_identity", internalId:identity.clientContextKey, resolved:true, status:"confirmed", linkSource:"exact_phone_unique", roles:["owner"] };
    await invokeShadowPhase3A({ admin, envelope:{sanitizedText:"Hola",providerMetadata:{respondContactId:`synthetic-legacy-${ref}`}},
      deterministic:{requiresHuman:true}, toolResults:[{name:"resolve_contact_identity",args:{},ok:true,result:[legacyIdentity]}],
      systemPrompt:"fixture",toolGuide:"fixture",modelCall:async(messages)=>{context=JSON.parse(messages[1].content);return {text:"{}"};} });
    const { entityType, internalId, ...expectedLegacyPayload } = legacyIdentity;
    const { internalId: alias, ...actual } = context.tools[0].result[0];
    assert.deepEqual(actual,expectedLegacyPayload);
    assert.match(alias,/^ref_[a-z]+_\d+$/);
    assert.equal(JSON.stringify(context).includes(internalId),false);
  }
});

test("UI muestra identidad resuelta separada de selección de unidad y gates no activados", () => {
  const scope = fs.readFileSync(new URL("../components/RunIdentityScope.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.match(scope, /no determinada/); assert.match(scope, /sin selección/);
  assert.match(page, /identityPreflightAuthorized && <CondominiumIdentityReview/);
  assert.match(page, /<RunIdentityScope item=\{item\}/);
});

test("múltiples unidades aprobadas: identidad única, selección de unidad ambigua", async () => {
  const tables = confirmedCondoTables({ count: 2 }); const admin = memoryAdmin(tables);
  const identity = await resolveApprovedCondominiumIdentity(admin, tables.respond_identity_links[0]);
  assert.equal(identity.resolved, true); assert.equal(identity.ambiguousUnitContext, true); assert.equal(identity.selectedUnitId, null);
  const tool = await loadCondominiumIdentityBefore3A(admin, condominiumCases[0].contactId);
  const [observed] = buildShadowRunIdentityObservability({ runs: [{ id: "synthetic-run", tool_results_json: [tool] }] });
  assert.equal(observed.identityState, "confirmed"); assert.equal(observed.unitResolved, false); assert.equal(observed.unitRef, null);
  assert.equal(observed.relationshipResolved, true); assert.equal(observed.attributionReason, "insufficient_unit_context");
  assert.equal(observed.inExactPhone7of7, false); assert.equal(observed.propertyResolved, false);
});

for (const [name, mutate, reason] of [
  ["unidad inactiva", (t) => { t.unidades_condominio[0].activo = false; }, "inactive_or_changed_condominium_relationship"],
  ["condominio inactivo", (t) => { t.condominios[0].activo = false; }, "inactive_or_changed_condominium_relationship"],
  ["relación revocada", (t) => { t.client_source_links[0].link_status = "revoked"; }, "no_approved_condominium_relationship"],
  ["identidad revocada", (t) => { t.client_identities[0].status = "revoked"; }, "canonical_identity_inactive"],
  ["rol revocado", (t) => { t.client_identity_roles[0].status = "revoked"; }, "canonical_role_conflict"],
  ["teléfono cambió", (t) => { t.unidades_condominio[0].propietario_telefono = "5550100099"; }, "approved_source_phone_changed"],
  ["condominio cambiado", (t) => { t.unidades_condominio[0].condominio_id = fixtureUuid(99); }, "inactive_or_changed_condominium_relationship"],
  ["relación editada con mismo teléfono", (t) => { t.unidades_condominio[0].identity_owner_version = 2; }, "source_relationship_changed"],
]) test(`${name}: fail-closed sin acceder a Rentas`, async () => {
  const tables = confirmedCondoTables(); mutate(tables);
  const result = await resolveApprovedCondominiumIdentity(memoryAdmin(tables), tables.respond_identity_links[0]);
  assert.equal(result.resolved, false); assert.equal(result.reason, reason);
});

test("identidad aprobada presente en primera y segunda llamada 3A, sin teléfonos ni nombres", async () => {
  const admin = memoryAdmin(confirmedCondoTables()); const tools = []; const contexts = [];
  for (let round = 0; round < 2; round++) await invokeShadowPhase3A({ admin, envelope: { sanitizedText: "Hola, gracias por la información.", providerMetadata: { respondContactId: condominiumCases[0].contactId } },
    deterministic: { intent: "otro", requiresHuman: true }, toolResults: tools, round, systemPrompt: "synthetic", toolGuide: "synthetic",
    modelCall: async (messages) => { contexts.push(JSON.parse(messages[1].content)); return { text: "{}" }; },
  });
  assert.equal(tools.length, 1);
  for (const context of contexts) {
    const identity = context.tools[0].result[0]; const unit = context.tools[0].result[1];
    assert.equal(identity.resolved, true); assert.equal(identity.identityDomain, "condominium");
    assert.match(unit.unitId, /^ref_[a-z]+_\d+$/); assert.equal(unit.entityType, "condominium_unit");
    assert.equal(JSON.stringify(context).includes(condominiumCases[0].unitId), false);
    assert.equal(tools[0].result[1].unitId, condominiumCases[0].unitId);
    assert.equal(unit.propertyId, undefined); assert.doesNotMatch(JSON.stringify(context), /525550100001|phone_digest|propietario_telefono/);
    assert.equal(context.deterministic.requiresHuman, true);
  }
  const [observed] = buildShadowRunIdentityObservability({ runs: [{ id: "synthetic", tool_results_json: tools }] });
  assert.equal(observed.unitResolved, true); assert.equal(observed.resolutionSource, "condominium_owner_admin_review");
});

test("fallo leyendo identidad antes de 3A: cero model calls", async () => {
  let calls = 0;
  await assert.rejects(invokeShadowPhase3A({ admin: { from() { throw new Error("read_failure"); } }, envelope: { sanitizedText: "Hola", providerMetadata: { respondContactId: "synthetic" } }, modelCall() { calls++; } }), /read_failure/);
  assert.equal(calls, 0);
});

test("caller no puede suministrar digest/evidenceHash ni confirmar sin revisión explícita", async () => {
  let reads = 0, writes = 0;
  const args = { admin: { rpc() { writes++; } }, actor: condoActor, env: condoEnv, fetchContact() { reads++; } };
  for (const field of ["phone_digest", "observedDigest", "evidenceHash", "existingIdentityId"]) await assert.rejects(reviewCondominiumIdentity({ ...args, body: { action: "condominium_prepare", unitId: fixtureUuid(101), respondContactId: "synthetic", [field]: "arbitrary" } }), /invalid_condominium_review/);
  await assert.rejects(reviewCondominiumIdentity({ ...args, body: { action: "condominium_confirm", candidateId: fixtureUuid(1) } }), /explicit_ownership_review_required/);
  await assert.rejects(reviewCondominiumIdentity({ ...args, body: { action: "condominium_prepare", unitId:fixtureUuid(101), respondContactId:"synthetic", attachConfirmedIdentity:true } }), /explicit_ownership_review_required/);
  assert.equal(reads, 0); assert.equal(writes, 0);
});

test("lectura actual Respond precede RPC; sólo digest en memoria y rechazo explícito", async () => {
  const calls = [];
  const admin = memoryAdmin({}, async (name, args) => { calls.push(args); return { data: { status: "requires_review", candidate_id: fixtureUuid(301) }, error: null }; });
  const body = { action: "condominium_prepare", unitId: fixtureUuid(101), respondContactId: "synthetic" };
  const result = await reviewCondominiumIdentity({ admin, actor: condoActor, body, env: condoEnv, fetchContact: async (id) => ({ id, phone: "+52 555 010 0001", name: "DO NOT PERSIST" }) });
  assert.equal(calls[0].p_observed_digest, fixtureDigest("525550100001"));
  assert.doesNotMatch(JSON.stringify(calls) + JSON.stringify(result), /DO NOT PERSIST|525550100001/);
  await reviewCondominiumIdentity({ admin, actor: condoActor, body, env: condoEnv, fetchContact: async () => ({ id: "different", phone: "5550100001" }) });
  assert.equal(calls[1].p_server_rejection, "respond_contact_not_found"); assert.equal(calls[1].p_observed_digest, null);
});

test("API: sólo POST/admin activo/same-origin; gates OFF impiden cualquier lectura o RPC", async () => {
  const response = () => ({ setHeader() {}, status(n) { this.code = n; return this; }, json(b) { this.body = b; return this; } });
  for (const [method, actor, origin, env, expected] of [["GET",condoActor,true,condoEnv,405],["POST",null,true,condoEnv,403],["POST",{ ...condoActor, active:false },true,condoEnv,403],["POST",{ ...condoActor, role_id:"coord_operaciones" },true,condoEnv,403],["POST",condoActor,false,condoEnv,403],["POST",condoActor,true,{},409]]) {
    const res = response(); let created = 0;
    await createCondominiumIdentityReviewHandler({ authorize: async () => actor, isSameOrigin: () => origin, env, createAdminClient() { created++; } })({ method, body:{action:"condominium_list"} },res);
    assert.equal(res.code, expected); assert.equal(created, 0);
  }
});

test("UI transport: token fresco, cero POST sin sesión/admin, sin retry", async () => {
  const calls = []; const post = async (url, options) => { calls.push(options); return { ok:true, json:async()=>({ok:true}) }; };
  const session = { user:{id:condoActor.id}, access_token:"synthetic-rotated", expires_at: 9999999999 };
  await requestCondominiumIdentityReview({ supabase:{auth:{getSession:async()=>({data:{session}})}}, profile:condoActor, body:{action:"condominium_list"}, fetchImpl:post });
  assert.equal(calls.length,1); assert.equal(calls[0].headers.Authorization,"Bearer synthetic-rotated"); assert.equal(calls[0].credentials,"same-origin");
  for (const value of [null,{...session,expires_at:1},{...session,access_token:null},{...session,user:{id:fixtureUuid(88)}}]) await assert.rejects(requestCondominiumIdentityReview({supabase:{auth:{getSession:async()=>({data:{session:value}})}},profile:condoActor,body:{},fetchImpl:post}),/fresh_session_required/);
  assert.equal(calls.length,1);
});

test("la revisión legacy no puede confirmar ni revocar el nuevo vínculo", async () => {
  const admin = memoryAdmin(confirmedCondoTables());
  await assert.rejects(reviewIdentityLink(admin, { linkId: fixtureUuid(30), action:"confirm", actorProfileId:condoActor.id }), /condominium_review_required/);
});

test("capacidad reutilizable sin cohorte hardcodeada ni accesos portal/finanzas", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/202609180001_condominium_owner_canonical_identity.sql", import.meta.url),"utf8");
  const component = fs.readFileSync(new URL("../components/CondominiumIdentityReview.js", import.meta.url),"utf8");
  for (const c of condominiumCases) assert.ok(!sql.includes(c.runRef) && !component.includes(c.runRef));
  assert.doesNotMatch(sql,/insert into public\.(properties|contracts|profiles|users|condominium_unit_portal_access)/i);
  assert.match(component,/window\.confirm/); assert.match(component,/pending\.current/); assert.match(component,/ownershipReviewed: true/);
  assert.doesNotMatch(component,/setInterval|setTimeout|service_role|SUPABASE_SERVICE/);
});
