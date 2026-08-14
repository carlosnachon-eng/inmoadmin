import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pilotSource = await readFile(
  new URL("../lib/whatsappAttribution/respondAttribution.js", import.meta.url),
  "utf8",
);
const receiverSource = await readFile(
  new URL("../pages/api/webhooks/respond-attribution-pilot.js", import.meta.url),
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
  };
}

const pilotHarness = pilotSource
  .replace(
    /import \{ DEV_PROJECT_REF \} from "\.\.\/ejecutivo\/workCenter";/,
    'const DEV_PROJECT_REF = "hjfwjnejbcpmknvfpdcq";',
  )
  .replace(
    /import \{ extractRespondWebhookEvent \} from "\.\.\/ejecutivo\/respondWebhook";/,
    "const extractRespondWebhookEvent = globalThis.__attributionPilotExtractEvent;",
  );
globalThis.__attributionPilotExtractEvent = extractRespondWebhookEvent;

const pilot = await import(
  `data:text/javascript;base64,${Buffer.from(pilotHarness).toString("base64")}`
);

const {
  assertRespondAttributionPilotEnvironment,
  extractAttributionObservation,
  extractWhatsappAttributionReference,
  incomingRespondText,
  persistAttributionObservation,
  resolveRespondAttributionSigningKey,
  validPilotSignature,
} = pilot;

const REFERENCE = "ABCDE-FGHJK-MNPQR-STVWZ";
const SIGNING_KEY = "qa-signing-key-minimum-32-bytes";
const EVENT_ID = "qa-attribution-message-1";
const CONTACT_ID = "510268526";
const MESSAGE_ID = "qa-message-1";

function serviceRoleFor(ref = "hjfwjnejbcpmknvfpdcq") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role: "service_role", ref })).toString("base64url");
  return `${header}.${payload}.qa`;
}

function previewEnv(overrides = {}) {
  return {
    VERCEL_ENV: "preview",
    WHATSAPP_ATTRIBUTION_PILOT_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://hjfwjnejbcpmknvfpdcq.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "qa-anon",
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleFor(),
    RESPOND_ATTRIBUTION_PILOT_SIGNING_KEY: SIGNING_KEY,
    ...overrides,
  };
}

function officialIncomingFixture({ text = `Mensaje QA modificado. Ref: ${REFERENCE}`, eventId = EVENT_ID } = {}) {
  return {
    event_id: eventId,
    event_type: "message.received",
    contact: { id: Number(CONTACT_ID) },
    message: {
      contactId: Number(CONTACT_ID),
      messageId: MESSAGE_ID,
      timestamp: 1786723200000,
      traffic: "incoming",
      message: { type: "text", text },
    },
  };
}

const signatureFor = (body, key = SIGNING_KEY) => createHmac("sha256", key)
  .update(JSON.stringify(body))
  .digest("base64");

test("guardas permiten únicamente Preview + Supabase DEV + service_role DEV", () => {
  assert.equal(assertRespondAttributionPilotEnvironment(previewEnv()).projectRef, "hjfwjnejbcpmknvfpdcq");
  for (const unsafe of [
    { VERCEL_ENV: "production" },
    { WHATSAPP_ATTRIBUTION_PILOT_ENABLED: "false" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://bnzrnizrmonjxlktbhlp.supabase.co" },
    { SUPABASE_SERVICE_ROLE_KEY: serviceRoleFor("bnzrnizrmonjxlktbhlp") },
    { SUPABASE_SERVICE_ROLE_KEY: "not-a-jwt" },
  ]) assert.throws(() => assertRespondAttributionPilotEnvironment(previewEnv(unsafe)));
});

test("signing key es propia y suficientemente fuerte", () => {
  assert.equal(resolveRespondAttributionSigningKey(previewEnv()), SIGNING_KEY);
  assert.throws(() => resolveRespondAttributionSigningKey(previewEnv({ RESPOND_ATTRIBUTION_PILOT_SIGNING_KEY: "short" })));
});

test("HMAC conserva contrato Base64(HMAC-SHA256(key, JSON.stringify(body)))", () => {
  const body = officialIncomingFixture();
  assert.equal(validPilotSignature(body, signatureFor(body), SIGNING_KEY, createHmac), true);
  assert.equal(validPilotSignature(body, signatureFor({ ...body, event_id: "altered" }), SIGNING_KEY, createHmac), false);
  assert.equal(validPilotSignature(body, null, SIGNING_KEY, createHmac), false);
});

test("payload oficial message.received obtiene texto transitorio y IDs técnicos", () => {
  const body = officialIncomingFixture();
  assert.equal(incomingRespondText(body), `Mensaje QA modificado. Ref: ${REFERENCE}`);
  assert.deepEqual(extractAttributionObservation(body), {
    referenceCode: REFERENCE,
    webhookEventId: EVENT_ID,
    respondContactId: CONTACT_ID,
    messageId: MESSAGE_ID,
    occurredAt: "2026-08-14T16:00:00.000Z",
  });
});

test("mensaje modificado conserva atribución mientras la Ref siga intacta", () => {
  for (const text of [
    `Texto totalmente distinto. Ref: ${REFERENCE}`,
    `Prefijo QA\nRef: ${REFERENCE}.`,
    `Ref: ${REFERENCE}`,
  ]) assert.equal(extractAttributionObservation(officialIncomingFixture({ text })).referenceCode, REFERENCE);
});

test("sin Ref, Ref inválida o dos refs distintas no fuerza atribución", () => {
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

test("persistencia RPC contiene IDs técnicos y nunca cuerpo del mensaje", async () => {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { status: "contact_linked" }, error: null };
    },
  };
  const body = officialIncomingFixture();
  const result = await persistAttributionObservation(admin, extractAttributionObservation(body));
  assert.equal(result.status, "contact_linked");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "observe_whatsapp_attribution_message");
  assert.deepEqual(calls[0].args, {
    p_reference_code: REFERENCE,
    p_webhook_event_id: EVENT_ID,
    p_respond_contact_id: CONTACT_ID,
    p_message_id: MESSAGE_ID,
    p_event_occurred_at: "2026-08-14T16:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(calls), /Mensaje QA|message_text|body/);
});

test("receiver dedicado no toca cola, snapshots, worker ni Respond.io", () => {
  assert.doesNotMatch(receiverSource, /gv_respond_webhook_events|gv_respond_contact_snapshots|claim_respond_webhook_contacts/);
  assert.doesNotMatch(receiverSource, /RESPOND_IO_TOKEN|api\.respond\.io|fetch\(/);
  assert.match(receiverSource, /observe_whatsapp_attribution_message|persistAttributionObservation/);
  assert.match(receiverSource, /storage_failed_open/);
});

const receiverState = { calls: [], rpcError: null };
globalThis.__pilotReceiverDeps = {
  createHmac,
  getAdminSupabase() {
    return {
      async rpc(name, args) {
        receiverState.calls.push({ name, args });
        return { data: { status: "contact_linked" }, error: receiverState.rpcError };
      },
    };
  },
  async readRespondWebhookBody(req) { return req.body; },
  assertRespondAttributionPilotEnvironment: () => assertRespondAttributionPilotEnvironment(process.env),
  extractAttributionObservation,
  persistAttributionObservation,
  resolveRespondAttributionSigningKey: () => resolveRespondAttributionSigningKey(process.env),
  validPilotSignature,
};

const receiverHarness = receiverSource
  .replace(/import \{ createHmac \} from "crypto";/, "const { createHmac } = globalThis.__pilotReceiverDeps;")
  .replace(
    /import \{ getAdminSupabase \} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/workCenter";/,
    "const { getAdminSupabase } = globalThis.__pilotReceiverDeps;",
  )
  .replace(
    /import \{ readRespondWebhookBody \} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/respondWebhook";/,
    "const { readRespondWebhookBody } = globalThis.__pilotReceiverDeps;",
  )
  .replace(
    /import \{[\s\S]*?\} from "\.\.\/\.\.\/\.\.\/lib\/whatsappAttribution\/respondAttribution";/,
    "const { assertRespondAttributionPilotEnvironment, extractAttributionObservation, persistAttributionObservation, resolveRespondAttributionSigningKey, validPilotSignature } = globalThis.__pilotReceiverDeps;",
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

async function withPreviewEnv(callback) {
  const before = {};
  const env = previewEnv();
  for (const [key, value] of Object.entries(env)) {
    before[key] = process.env[key];
    process.env[key] = value;
  }
  try { return await callback(); } finally {
    for (const key of Object.keys(env)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test("receiver retorna 200 y vincula una vez con firma válida", async () => {
  await withPreviewEnv(async () => {
    receiverState.calls = [];
    receiverState.rpcError = null;
    const body = officialIncomingFixture();
    const res = responseRecorder();
    await receiverHandler({ method: "POST", body, headers: { "x-webhook-signature": signatureFor(body) } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { ok: true, attribution: "contact_linked" });
    assert.equal(receiverState.calls.length, 1);
  });
});

test("receiver rechaza firma inválida sin tocar DEV", async () => {
  await withPreviewEnv(async () => {
    receiverState.calls = [];
    const body = officialIncomingFixture();
    const res = responseRecorder();
    await receiverHandler({ method: "POST", body, headers: { "x-webhook-signature": "invalid" } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(receiverState.calls.length, 0);
  });
});

test("fallo de almacenamiento responde 200 y no filtra mensaje ni secretos", async () => {
  await withPreviewEnv(async () => {
    receiverState.calls = [];
    receiverState.rpcError = { code: "qa_storage_failure", message: `secret=${SIGNING_KEY}` };
    const body = officialIncomingFixture();
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const res = responseRecorder();
      await receiverHandler({ method: "POST", body, headers: { "x-webhook-signature": signatureFor(body) } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.payload, { ok: true, attribution: "storage_failed_open" });
      assert.doesNotMatch(JSON.stringify({ logs, response: res.payload }), /Mensaje QA|qa-signing-key/);
    } finally {
      receiverState.rpcError = null;
      console.error = originalError;
    }
  });
});

test("Preview apagado responde 404 y no escribe", async () => {
  await withPreviewEnv(async () => {
    process.env.WHATSAPP_ATTRIBUTION_PILOT_ENABLED = "false";
    receiverState.calls = [];
    const body = officialIncomingFixture();
    const res = responseRecorder();
    await receiverHandler({ method: "POST", body, headers: { "x-webhook-signature": signatureFor(body) } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(receiverState.calls.length, 0);
  });
});
