import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleSource = await readFile(
  new URL("../lib/ejecutivo/respondWebhook.js", import.meta.url),
  "utf8",
);
const receiverSource = await readFile(
  new URL("../pages/api/webhooks/respond.js", import.meta.url),
  "utf8",
);
const migrationSource = await readFile(
  new URL("../supabase/migrations/202608100003_fase_2a1a_respond_incremental_webhooks.sql", import.meta.url),
  "utf8",
);
const {
  MAX_RESPOND_WEBHOOK_SIGNING_KEYS,
  extractRespondWebhookEvent,
  isValidRespondWebhookSignature,
  readRespondWebhookBody,
  resolveRespondWebhookSigningKeys,
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

const BODY = {
  event_id: "qa-event-multi-hmac",
  event_type: "contact.created",
  contact: { id: 510268526 },
};
const signatureFor = (key, body = BODY) => createHmac("sha256", key)
  .update(JSON.stringify(body))
  .digest("base64");

test("acepta la clave singular legacy", () => {
  const keys = resolveRespondWebhookSigningKeys({ legacySigningKey: "legacy-key" });
  assert.deepEqual(keys, ["legacy-key"]);
  assert.equal(isValidRespondWebhookSignature(BODY, signatureFor("legacy-key"), keys), true);
});

test("acepta primera, segunda y última clave del array", () => {
  const keys = resolveRespondWebhookSigningKeys({
    signingKeysJson: JSON.stringify(["key-1", "key-2", "key-3"]),
    legacySigningKey: "legacy-key",
  });
  assert.deepEqual(keys, ["key-1", "key-2", "key-3"]);
  for (const key of keys) {
    assert.equal(isValidRespondWebhookSignature(BODY, signatureFor(key), keys), true);
  }
});

test("acepta un array con una sola clave", () => {
  const keys = resolveRespondWebhookSigningKeys({ signingKeysJson: '["only-key"]' });
  assert.deepEqual(keys, ["only-key"]);
  assert.equal(isValidRespondWebhookSignature(BODY, signatureFor("only-key"), keys), true);
});

test("rechaza firma ausente, desconocida o de body alterado", () => {
  const keys = ["key-1", "key-2"];
  assert.equal(isValidRespondWebhookSignature(BODY, null, keys), false);
  assert.equal(isValidRespondWebhookSignature(BODY, signatureFor("other-key"), keys), false);
  assert.equal(
    isValidRespondWebhookSignature({ ...BODY, event_id: "altered" }, signatureFor("key-1"), keys),
    false,
  );
});

test("JSON inválido falla cerrado sin incluir el secreto en el error", () => {
  const invalidSecret = "not-json-secret-value";
  assert.throws(
    () => resolveRespondWebhookSigningKeys({
      signingKeysJson: invalidSecret,
      legacySigningKey: "legacy-key",
    }),
    (error) => {
      assert.equal(error.code, "respond_webhook_signing_keys_invalid");
      assert.equal(error.statusCode, 503);
      assert.doesNotMatch(error.message, new RegExp(invalidSecret));
      assert.doesNotMatch(error.message, /legacy-key/);
      return true;
    },
  );
});

test("array vacío usa fallback singular y sin fallback falla cerrado", () => {
  assert.deepEqual(
    resolveRespondWebhookSigningKeys({ signingKeysJson: "[]", legacySigningKey: "legacy-key" }),
    ["legacy-key"],
  );
  assert.throws(
    () => resolveRespondWebhookSigningKeys({ signingKeysJson: "[]", legacySigningKey: "" }),
    /Configuracion de firma webhook invalida/,
  );
});

test("deduplica claves en memoria y limita el conjunto autorizado", () => {
  assert.deepEqual(
    resolveRespondWebhookSigningKeys({
      signingKeysJson: JSON.stringify(["key-1", " key-1 ", "key-2"]),
    }),
    ["key-1", "key-2"],
  );
  assert.throws(
    () => resolveRespondWebhookSigningKeys({
      signingKeysJson: JSON.stringify(Array.from(
        { length: MAX_RESPOND_WEBHOOK_SIGNING_KEYS + 1 },
        (_, index) => `key-${index}`,
      )),
    }),
    /Configuracion de firma webhook invalida/,
  );
});

test("rechaza arrays con valores no string o vacíos", () => {
  for (const invalid of [
    ["valid", ""],
    ["valid", "   "],
    ["valid", null],
    ["valid", 123],
    { key: "not-an-array" },
  ]) {
    assert.throws(
      () => resolveRespondWebhookSigningKeys({ signingKeysJson: JSON.stringify(invalid) }),
      /Configuracion de firma webhook invalida/,
    );
  }
});

test("el evento normalizado no persiste claves ni firmas", () => {
  const event = extractRespondWebhookEvent({
    ...BODY,
    signing_key: "must-not-persist",
    signature: "must-not-persist",
  });
  assert.equal(event.eventId, BODY.event_id);
  assert.equal(event.respondContactId, String(BODY.contact.id));
  assert.deepEqual(event.payloadMeta, {});
  assert.doesNotMatch(JSON.stringify(event), /must-not-persist/);
});

test("receiver conserva deduplicación y no registra secretos", () => {
  assert.match(receiverSource, /resolveRespondWebhookSigningKeys\(\)/);
  assert.match(receiverSource, /error\?\.code === "23505"/);
  assert.match(receiverSource, /duplicate: true/);
  assert.match(migrationSource, /event_id text primary key/);
  assert.doesNotMatch(receiverSource, /console\.(log|info|warn)\([^\n]*(signingKey|signingKeys|signature)/);
  assert.doesNotMatch(receiverSource, /payload_meta:[^\n]*(signingKey|signingKeys|signature)/);
});

const receiverState = { insertResult: { error: null }, inserted: [] };
globalThis.__respondReceiverTestDeps = {
  assertSupabaseEnvironment() {},
  assertRespondIncrementalWebhooksEnabled() {},
  async observeWhatsappAttributionFailOpen() { return { status: "ignored" }; },
  getAdminSupabase() {
    return {
      from(table) {
        assert.equal(table, "gv_respond_webhook_events");
        return {
          async insert(row) {
            receiverState.inserted.push(row);
            return receiverState.insertResult;
          },
        };
      },
    };
  },
  extractRespondWebhookEvent,
  isValidRespondWebhookSignature,
  readRespondWebhookBody,
  resolveRespondWebhookSigningKeys,
};

const receiverHarnessSource = receiverSource
  .replace(
    /import \{[\s\S]*?\} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/workCenter";/,
    "const { assertSupabaseEnvironment, getAdminSupabase } = globalThis.__respondReceiverTestDeps;",
  )
  .replace(
    /import \{ assertRespondIncrementalWebhooksEnabled \} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/respondSync";/,
    "const { assertRespondIncrementalWebhooksEnabled } = globalThis.__respondReceiverTestDeps;",
  )
  .replace(
    /import \{[\s\S]*?\} from "\.\.\/\.\.\/\.\.\/lib\/ejecutivo\/respondWebhook";/,
    "const { extractRespondWebhookEvent, isValidRespondWebhookSignature, readRespondWebhookBody, resolveRespondWebhookSigningKeys } = globalThis.__respondReceiverTestDeps;",
  )
  .replace(
    /import \{ observeWhatsappAttributionFailOpen \} from "\.\.\/\.\.\/\.\.\/lib\/whatsappAttribution\/respondAttribution";/,
    "const { observeWhatsappAttributionFailOpen } = globalThis.__respondReceiverTestDeps;",
  );
const { default: receiverHandler } = await import(
  `data:text/javascript;base64,${Buffer.from(receiverHarnessSource).toString("base64")}`
);

function requestFor(body, signature) {
  const payload = Buffer.from(JSON.stringify(body));
  return {
    method: "POST",
    headers: signature ? { "x-webhook-signature": signature } : {},
    async *[Symbol.asyncIterator]() { yield payload; },
  };
}

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function withSigningEnvironment({ plural, legacy }, callback) {
  const beforePlural = process.env.RESPOND_WEBHOOK_SIGNING_KEYS;
  const beforeLegacy = process.env.RESPOND_WEBHOOK_SIGNING_KEY;
  if (plural === undefined) delete process.env.RESPOND_WEBHOOK_SIGNING_KEYS;
  else process.env.RESPOND_WEBHOOK_SIGNING_KEYS = plural;
  if (legacy === undefined) delete process.env.RESPOND_WEBHOOK_SIGNING_KEY;
  else process.env.RESPOND_WEBHOOK_SIGNING_KEY = legacy;
  try {
    return await callback();
  } finally {
    if (beforePlural === undefined) delete process.env.RESPOND_WEBHOOK_SIGNING_KEYS;
    else process.env.RESPOND_WEBHOOK_SIGNING_KEYS = beforePlural;
    if (beforeLegacy === undefined) delete process.env.RESPOND_WEBHOOK_SIGNING_KEY;
    else process.env.RESPOND_WEBHOOK_SIGNING_KEY = beforeLegacy;
  }
}

test("receiver devuelve 401 para firma faltante o desconocida sin tocar la cola", async () => {
  await withSigningEnvironment({ plural: '["key-1","key-2"]' }, async () => {
    receiverState.inserted = [];
    for (const signature of [undefined, signatureFor("unknown")]) {
      const res = responseRecorder();
      await receiverHandler(requestFor(BODY, signature), res);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.payload, { ok: false, error: "Firma invalida." });
    }
    assert.equal(receiverState.inserted.length, 0);
  });
});

test("receiver encola una vez y conserva respuesta idempotente para duplicado", async () => {
  await withSigningEnvironment({ plural: '["key-1","key-2"]' }, async () => {
    receiverState.inserted = [];
    receiverState.insertResult = { error: null };
    const queued = responseRecorder();
    await receiverHandler(requestFor(BODY, signatureFor("key-2")), queued);
    assert.equal(queued.statusCode, 200);
    assert.deepEqual(queued.payload, { ok: true, queued: true });
    assert.equal(receiverState.inserted.length, 1);
    assert.equal(receiverState.inserted[0].event_id, BODY.event_id);
    assert.equal(receiverState.inserted[0].event_type, BODY.event_type);
    assert.equal(receiverState.inserted[0].respond_contact_id, String(BODY.contact.id));
    assert.doesNotMatch(JSON.stringify(receiverState.inserted[0]), /key-1|key-2/);

    receiverState.insertResult = { error: { code: "23505" } };
    const duplicate = responseRecorder();
    await receiverHandler(requestFor(BODY, signatureFor("key-2")), duplicate);
    assert.equal(duplicate.statusCode, 200);
    assert.deepEqual(duplicate.payload, { ok: true, duplicate: true });
  });
});

test("receiver falla cerrado ante JSON inválido sin filtrar secretos", async () => {
  const invalidSecret = "invalid-secret-json";
  await withSigningEnvironment({ plural: invalidSecret, legacy: "legacy-secret" }, async () => {
    receiverState.inserted = [];
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      const res = responseRecorder();
      await receiverHandler(requestFor(BODY, signatureFor("legacy-secret")), res);
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.payload, { ok: false, error: "No se pudo persistir el evento." });
      assert.equal(receiverState.inserted.length, 0);
      assert.doesNotMatch(JSON.stringify({ errors, response: res.payload }), /invalid-secret-json|legacy-secret/);
    } finally {
      console.error = originalError;
    }
  });
});
