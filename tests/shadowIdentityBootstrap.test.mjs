import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  bootstrapHistoricalIdentityCohort,
  buildHistoricalIdentityIndex,
  opaqueIdentityContactRef,
  sameOriginAdminRequest,
  validateHistoricalIdentityRefs,
} from "../lib/shadow/identityBootstrap.js";
import { ingestShadowEnvelope } from "../lib/shadow/coordinator.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientA = "11111111-1111-4111-8111-111111111111";
const clientB = "22222222-2222-4222-8222-222222222222";
const event = (id, overrides = {}) => ({
  respond_contact_id: id,
  event_type: "message.received",
  event_occurred_at: "2026-08-26T12:00:00.000Z",
  payload_meta: { channel_id: "544519" },
  ...overrides,
});

function query(result) {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => result, single: async () => result, then: (resolve) => resolve(result),
  };
  return chain;
}

function adminFor(candidateRows = [], prior = null) {
  const links = [];
  const audits = [];
  return {
    links, audits,
    rpc: async (name) => name === "find_respond_identity_candidates" ? { data: candidateRows, error: null } : { data: null, error: new Error(name) },
    from(table) {
      if (table === "respond_identity_links") return {
        select: () => query({ data: prior, error: null }),
        insert(row) { links.push(row); return { select: () => ({ single: async () => ({ data: { id: `link-${links.length}` }, error: null }) }) }; },
      };
      if (table === "respond_identity_audit") return { insert: async (row) => { audits.push(row); return { error: null }; } };
      throw new Error(table);
    },
  };
}

async function run({ contactId = "contact-1", candidates = [], contact = { id: "contact-1", phone: "+52 222 123 4567" }, prior = null } = {}) {
  const admin = adminFor(candidates, prior);
  const contactRef = opaqueIdentityContactRef(contactId);
  const results = await bootstrapHistoricalIdentityCohort(admin, {
    contactRefs: [contactRef], actorProfileId: actor, eventRows: [event(contactId)], fetchContact: async () => contact,
  });
  return { admin, result: results[0], contactRef };
}

test("histórico con candidato único reutiliza matching canónico y nunca confirma", async () => {
  const { admin, result } = await run({ candidates: [{ inmoadmin_client_id: clientA, contract_id: "c1", property_id: "p1" }] });
  assert.equal(result.status, "unique_candidate");
  assert.equal(admin.links[0].link_status, "candidate");
  assert.equal(admin.links.some((row) => row.link_status === "confirmed"), false);
  assert.equal(admin.audits.at(-1).event_type, "bootstrap_evaluated");
});

test("histórico con múltiples coincidencias exactas produce conflict", async () => {
  const { admin, result } = await run({ candidates: [{ inmoadmin_client_id: clientA }, { inmoadmin_client_id: clientB }] });
  assert.equal(result.status, "conflict");
  assert.deepEqual(admin.links.map((row) => row.link_status), ["conflict", "conflict"]);
});

test("histórico sin candidato queda no_candidate auditable", async () => {
  const { admin, result } = await run();
  assert.equal(result.status, "no_candidate");
  assert.equal(admin.links.length, 0);
  assert.equal(admin.audits.at(-1).context_ids.outcome, "no_candidate");
});

test("ID opaco fuera de eventos Admin elegibles no consulta Respond", async () => {
  let calls = 0;
  const results = await bootstrapHistoricalIdentityCohort(adminFor(), {
    contactRefs: [opaqueIdentityContactRef("outside")], actorProfileId: actor, eventRows: [event("contact-1")], fetchContact: async () => { calls += 1; },
  });
  assert.equal(results[0].status, "not_eligible"); assert.equal(calls, 0);
});

test("cohorte exige lista explícita de máximo 10 refs sin wildcard ni duplicados", () => {
  const refs = Array.from({ length: 10 }, (_, index) => opaqueIdentityContactRef(`c-${index}`));
  assert.deepEqual(validateHistoricalIdentityRefs(refs), refs);
  assert.throws(() => validateHistoricalIdentityRefs([...refs, opaqueIdentityContactRef("c-11")]), /invalid_historical_identity_cohort/);
  assert.throws(() => validateHistoricalIdentityRefs(["*"]), /invalid_historical_identity_cohort/);
  assert.throws(() => validateHistoricalIdentityRefs([refs[0], refs[0]]), /invalid_historical_identity_cohort/);
});

test("Respond error, teléfono ausente e inválido se sanitizan sin persistir respuesta", async () => {
  const ref = opaqueIdentityContactRef("contact-1");
  for (const [fetchContact, expected] of [
    [async () => { throw new Error("https://secret.invalid/?token=x"); }, "respond_read_error"],
    [async () => ({ id: "contact-1" }), "phone_missing"],
    [async () => ({ id: "contact-1", phone: "123" }), "phone_invalid"],
  ]) {
    const admin = adminFor();
    const [result] = await bootstrapHistoricalIdentityCohort(admin, { contactRefs: [ref], actorProfileId: actor, eventRows: [event("contact-1")], fetchContact });
    assert.equal(result.status, expected);
    assert.equal(JSON.stringify(admin.audits).includes("secret.invalid"), false);
  }
});

test("repetición es idempotente y candidate/confirmed existentes no duplican links", async () => {
  for (const [link_status, expected] of [["candidate", "unique_candidate"], ["confirmed", "confirmed_existing"]]) {
    const { admin, result } = await run({ prior: { link_status } });
    assert.equal(result.status, expected); assert.equal(result.existing, true); assert.equal(admin.links.length, 0);
  }
});

test("índice sólo admite message.received de 544519 y falla cerrado ante colisión", () => {
  const id = "contact-1";
  const rows = [event(id, { payload_meta: { channelId: "544519" } }), event("ventas", { payload_meta: { channel_id: "498219" } }), event("sent", { event_type: "message.sent" })];
  const index = buildHistoricalIdentityIndex(rows);
  assert.equal(index.size, 1); assert.equal(index.get(opaqueIdentityContactRef(id)).contactId, id);
});

test("API es admin-only, same-origin, cohorte explícita y no expone capacidades Respond de escritura", () => {
  const api = fs.readFileSync(new URL("../pages/api/operaciones/shadow-identity-bootstrap.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../pages/coordinador-ia-sombra.js", import.meta.url), "utf8");
  assert.match(api, /authorizeShadowAdministrator/);
  assert.match(api, /sameOriginAdminRequest/);
  assert.match(api, /fetchRespondContact/);
  assert.match(api, /validateHistoricalIdentityRefs/);
  assert.doesNotMatch(api, /send|outbound|assignee|lifecycle|workflow|customFields|RESPOND_IO_TOKEN/);
  assert.match(ui, /Evaluar cohorte seleccionada/);
  assert.match(ui, /identityBootstrapRefs\.length>=10/);
  assert.doesNotMatch(ui, /procesar todos|RESPOND_IO_TOKEN|SUPABASE_SERVICE_ROLE_KEY/i);
});

test("POST exige origen idéntico al host productivo", () => {
  assert.equal(sameOriginAdminRequest({ headers: { origin: "https://app.example.test", host: "app.example.test", "x-forwarded-proto": "https" } }), true);
  assert.equal(sameOriginAdminRequest({ headers: { origin: "https://evil.example", host: "app.example.test", "x-forwarded-proto": "https" } }), false);
  assert.equal(sameOriginAdminRequest({ headers: { host: "app.example.test" } }), false);
});

test("flujo canónico nuevo persiste respond_contact_id sólo en conversación Admin 544519", async () => {
  let updated = null;
  const updateQuery = {
    eq() { return updateQuery; },
    then(resolve) { resolve({ error: null }); },
  };
  const admin = {
    rpc: async () => ({ data: { status: "accepted", conversationId: "conversation-1" }, error: null }),
    from(table) {
      assert.equal(table, "shadow_conversations");
      return { update(value) { updated = value; return updateQuery; } };
    },
  };
  await ingestShadowEnvelope(admin, {
    provider: "respond_admin", externalEventId: "event-1", externalMessageId: "message-1",
    externalConversationId: "respond-conversation-1", externalContactId: "contact-1", channel: "544519",
    direction: "inbound", occurredAt: "2026-08-26T12:00:00.000Z", sanitizedText: "Seguimiento administrativo",
    providerMetadata: { respondContactId: "contact-1" },
  });
  assert.deepEqual(updated, { respond_contact_id: "contact-1" });
});

test("bootstrap no modifica Shadow, ERP ni usa Auto-Real", () => {
  const helper = fs.readFileSync(new URL("../lib/shadow/identityBootstrap.js", import.meta.url), "utf8");
  assert.doesNotMatch(helper, /shadow_conversations|shadow_messages|shadow_ingestion_events/);
  assert.doesNotMatch(helper, /payments|maintenance_tickets|\.from\([^)]*\)\.(?:update|upsert|delete)\(/);
  assert.doesNotMatch(helper, /autoReal|Claude|Anthropic/);
});

test("migración sólo amplía auditoría append-only sin PII", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/202608260001_fase_3a_identity_bootstrap_audit.sql", import.meta.url), "utf8");
  const checks = fs.readFileSync(new URL("../supabase/migrations/202608260001_fase_3a_identity_bootstrap_audit_checks.sql", import.meta.url), "utf8");
  assert.match(migration, /bootstrap_evaluated/);
  assert.doesNotMatch(migration, /phone|email|name|payload/);
  assert.match(checks, /append-only/);
  assert.match(checks, /UPDATE,DELETE,TRUNCATE/);
});
