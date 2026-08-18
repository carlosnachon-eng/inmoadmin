import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleSource = await readFile(
  new URL("../lib/whatsappAttribution/respondAttribution.js", import.meta.url),
  "utf8",
);
const receiverSource = await readFile(
  new URL("../pages/api/webhooks/respond.js", import.meta.url),
  "utf8",
);

function isoTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Date(number < 1e11 ? number * 1_000 : number).toISOString();
}

function extractRespondWebhookEvent(body) {
  const eventType = String(body?.event_type || body?.event || "").trim();
  const contactId = body?.contact?.id ?? body?.message?.contactId ?? null;
  return {
    eventId: String(body?.event_id || body?.eventId || "").trim(),
    eventType,
    supported: eventType === "message.received",
    respondContactId: contactId == null ? null : String(contactId),
    eventOccurredAt: isoTimestamp(body?.message?.timestamp),
    messageId: body?.message?.messageId ? String(body.message.messageId) : null,
    payloadMeta: { traffic: body?.message?.traffic || null },
  };
}

const moduleHarness = moduleSource.replace(
  /import \{ extractRespondWebhookEvent \} from "\.\.\/ejecutivo\/respondWebhook";/,
  "const extractRespondWebhookEvent = globalThis.__waExtractRespondWebhookEvent;",
);
globalThis.__waExtractRespondWebhookEvent = extractRespondWebhookEvent;
const attribution = await import(
  `data:text/javascript;base64,${Buffer.from(moduleHarness).toString("base64")}`
);

const {
  extractAttributionObservation,
  extractWhatsappAttributionReference,
  incomingRespondText,
  observeWhatsappAttributionFailOpen,
  persistAttributionObservation,
  WHATSAPP_ATTRIBUTION_TIMEOUT_MS,
  whatsappAttributionEnabled,
} = attribution;

const REFERENCE = "ABCDE-FGHJK-MNPQR-STVWZ";
const EVENT_ID = "qa-attribution-message-1";
const CONTACT_ID = "510268526";
const MESSAGE_ID = "qa-message-1";

function officialIncomingFixture({
  text = `Mensaje sintético. Ref: ${REFERENCE}`,
  eventId = EVENT_ID,
  contactId = CONTACT_ID,
} = {}) {
  return {
    event_id: eventId,
    event_type: "message.received",
    contact: { id: Number(contactId) },
    message: {
      contactId: Number(contactId),
      messageId: MESSAGE_ID,
      timestamp: 1786723200000,
      traffic: "incoming",
      message: { type: "text", text },
    },
  };
}

test("atribución está apagada por defecto y requiere flag explícita", () => {
  assert.equal(whatsappAttributionEnabled({}), false);
  assert.equal(whatsappAttributionEnabled({ WHATSAPP_ATTRIBUTION_ENABLED: "true" }), true);
  assert.equal(whatsappAttributionEnabled({ WHATSAPP_ATTRIBUTION_ENABLED: "false" }), false);
});

test("payload message.received obtiene Ref e IDs técnicos sin conservar el cuerpo", () => {
  const observation = extractAttributionObservation(officialIncomingFixture());
  assert.deepEqual(observation, {
    referenceCode: REFERENCE,
    webhookEventId: EVENT_ID,
    respondContactId: CONTACT_ID,
    messageId: MESSAGE_ID,
    occurredAt: "2026-08-14T16:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(observation), /Mensaje sintético/);
});

test("mensaje modificado conserva atribución si la Ref válida permanece", () => {
  for (const text of [
    `Texto distinto. Ref: ${REFERENCE}`,
    `Prefijo sintético\nRef: ${REFERENCE}.`,
    `Ref: ${REFERENCE}`,
  ]) assert.equal(extractAttributionObservation(officialIncomingFixture({ text })).referenceCode, REFERENCE);
});

test("Ref eliminada, inválida o ambigua no fuerza atribución", () => {
  assert.equal(extractWhatsappAttributionReference("Mensaje sin referencia"), null);
  assert.equal(extractWhatsappAttributionReference("Ref: INVALIDA"), null);
  assert.equal(
    extractWhatsappAttributionReference(`Ref: ${REFERENCE} Ref: 12345-6789A-BCDEF-GHJKM`),
    null,
  );
  assert.equal(extractAttributionObservation(officialIncomingFixture({ text: "sin ref" })), null);
});

test("solo incoming text puede atribuirse", () => {
  const outgoing = officialIncomingFixture();
  outgoing.message.traffic = "outgoing";
  assert.equal(incomingRespondText(outgoing), null);
  const attachment = officialIncomingFixture();
  attachment.message.message = { type: "attachment", url: "https://example.invalid/private" };
  assert.equal(incomingRespondText(attachment), null);
  assert.equal(extractAttributionObservation(attachment), null);
});

test("RPC recibe IDs técnicos y nunca PII ni cuerpo del mensaje", async () => {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { status: "contact_linked" }, error: null };
    },
  };
  const result = await persistAttributionObservation(admin, extractAttributionObservation(officialIncomingFixture()));
  assert.equal(result.status, "contact_linked");
  assert.deepEqual(calls[0], {
    name: "observe_whatsapp_attribution_message",
    args: {
      p_reference_code: REFERENCE,
      p_webhook_event_id: EVENT_ID,
      p_respond_contact_id: CONTACT_ID,
      p_message_id: MESSAGE_ID,
      p_event_occurred_at: "2026-08-14T16:00:00.000Z",
    },
  });
  assert.doesNotMatch(JSON.stringify(calls), /Mensaje sintético|message_text|phone|email/);
});

test("almacenamiento de atribución caído es fail-open y no filtra secretos/cuerpo", async () => {
  const logs = [];
  const result = await observeWhatsappAttributionFailOpen({
    admin: { rpc: async () => ({ data: null, error: { code: "qa_storage_failure", message: "secret-value" } }) },
    body: officialIncomingFixture(),
    env: { WHATSAPP_ATTRIBUTION_ENABLED: "true" },
    logger: { error: (...args) => logs.push(args.join(" ")) },
  });
  assert.deepEqual(result, { status: "storage_failed_open" });
  assert.deepEqual(logs, ["[respond-whatsapp-attribution] qa_storage_failure"]);
  assert.doesNotMatch(JSON.stringify(logs), /Mensaje sintético|secret-value/);
});

test("RPC colgada corta en timeout y conserva fail-open", async () => {
  const started = Date.now();
  const logs = [];
  const result = await observeWhatsappAttributionFailOpen({
    admin: { rpc: async () => new Promise(() => {}) },
    body: officialIncomingFixture(),
    env: { WHATSAPP_ATTRIBUTION_ENABLED: "true" },
    logger: { error: (...args) => logs.push(args.join(" ")) },
    timeoutMs: 10,
  });
  assert.deepEqual(result, { status: "storage_failed_open" });
  assert.ok(Date.now() - started < WHATSAPP_ATTRIBUTION_TIMEOUT_MS);
  assert.deepEqual(logs, ["[respond-whatsapp-attribution] storage_timeout_fail_open"]);
});

test("error de extracción también queda aislado del ACK canónico", async () => {
  const throwingBody = {
    get event_type() { throw Object.assign(new Error("qa extraction"), { code: "qa_extract_failure" }); },
  };
  const logs = [];
  const result = await observeWhatsappAttributionFailOpen({
    admin: {},
    body: throwingBody,
    env: { WHATSAPP_ATTRIBUTION_ENABLED: "true" },
    logger: { error: (...args) => logs.push(args.join(" ")) },
  });
  assert.deepEqual(result, { status: "storage_failed_open" });
  assert.deepEqual(logs, ["[respond-whatsapp-attribution] qa_extract_failure"]);
});

test("feature flag apagada y mensaje sin Ref no consultan almacenamiento", async () => {
  let calls = 0;
  const admin = { rpc: async () => { calls += 1; return { data: {}, error: null }; } };
  assert.deepEqual(await observeWhatsappAttributionFailOpen({
    admin, body: officialIncomingFixture(), env: {},
  }), { status: "disabled" });
  assert.deepEqual(await observeWhatsappAttributionFailOpen({
    admin,
    body: officialIncomingFixture({ text: "sin referencia" }),
    env: { WHATSAPP_ATTRIBUTION_ENABLED: "true" },
  }), { status: "ignored" });
  assert.equal(calls, 0);
});

test("contacto Respond.io existente se vincula por ID sin crear otra identidad", () => {
  const first = extractAttributionObservation(officialIncomingFixture({ contactId: "510268526" }));
  const second = extractAttributionObservation(officialIncomingFixture({
    eventId: "qa-attribution-message-2",
    contactId: "510268526",
    text: "Otra intención. Ref: 12345-6789A-BCDEF-GHJKM",
  }));
  assert.equal(first.respondContactId, second.respondContactId);
  assert.notEqual(first.referenceCode, second.referenceCode);
});

test("receiver canónico conserva una sola firma/cola y añade atribución después del insert", () => {
  assert.match(receiverSource, /resolveRespondWebhookSigningKeys/);
  assert.match(receiverSource, /gv_respond_webhook_events/);
  assert.match(receiverSource, /observeWhatsappAttributionFailOpen\(\{ admin, body \}\)/);
  assert.doesNotMatch(receiverSource, /RESPOND_ATTRIBUTION_PILOT_SIGNING_KEY|respond-attribution-pilot/);
  assert.ok(receiverSource.indexOf('admin.from("gv_respond_webhook_events")')
    < receiverSource.indexOf("await observeWhatsappAttributionFailOpen"));
});

const receiverState = {
  insertError: null,
  inserted: [],
  observed: [],
};
globalThis.__waReceiverDeps = {
  assertSupabaseEnvironment() {},
  assertRespondIncrementalWebhooksEnabled() {},
  extractRespondWebhookEvent,
  getAdminSupabase() {
    return {
      from(table) {
        return {
          async insert(row) {
            receiverState.inserted.push({ table, row });
            return { error: receiverState.insertError };
          },
        };
      },
    };
  },
  isValidRespondWebhookSignature: () => true,
  async observeWhatsappAttributionFailOpen({ body }) {
    receiverState.observed.push(body.event_id);
    return { status: "storage_failed_open" };
  },
  async readRespondWebhookBody(req) { return req.body; },
  resolveRespondWebhookSigningKeys: () => ["qa-key"],
};

const receiverHarness = receiverSource
  .replace(
    /import \{[\s\S]*?\} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/workCenter";/,
    "const { assertSupabaseEnvironment, getAdminSupabase } = globalThis.__waReceiverDeps;",
  )
  .replace(
    /import \{ assertRespondIncrementalWebhooksEnabled \} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/respondSync";/,
    "const { assertRespondIncrementalWebhooksEnabled } = globalThis.__waReceiverDeps;",
  )
  .replace(
    /import \{[\s\S]*?\} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/respondWebhook";/,
    "const { extractRespondWebhookEvent, isValidRespondWebhookSignature, readRespondWebhookBody, resolveRespondWebhookSigningKeys } = globalThis.__waReceiverDeps;",
  )
  .replace(
    /import \{ observeWhatsappAttributionFailOpen \} from "\.\.\/\.\.\/\.\.\/lib\/whatsappAttribution\/respondAttribution";/,
    "const { observeWhatsappAttributionFailOpen } = globalThis.__waReceiverDeps;",
  );

const { default: receiverHandler } = await import(
  `data:text/javascript;base64,${Buffer.from(receiverHarness).toString("base64")}`
);

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("fallo de atribución nunca cambia el 200 ni el encolado canónico", async () => {
  receiverState.insertError = null;
  receiverState.inserted = [];
  receiverState.observed = [];
  const body = officialIncomingFixture();
  const res = responseRecorder();
  await receiverHandler({ method: "POST", body, headers: { "x-webhook-signature": "qa" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, queued: true });
  assert.equal(receiverState.inserted.length, 1);
  assert.deepEqual(receiverState.observed, [EVENT_ID]);
});

test("webhook duplicado conserva ACK canónico e intenta atribución idempotente", async () => {
  receiverState.insertError = { code: "23505" };
  receiverState.inserted = [];
  receiverState.observed = [];
  const body = officialIncomingFixture();
  const res = responseRecorder();
  await receiverHandler({ method: "POST", body, headers: { "x-webhook-signature": "qa" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, duplicate: true });
  assert.deepEqual(receiverState.observed, [EVENT_ID]);
  receiverState.insertError = null;
});
