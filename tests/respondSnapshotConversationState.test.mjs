import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../lib/ejecutivo/respondSync.js", import.meta.url),
  "utf8",
);

globalThis.__respondSyncTestDeps = {
  resolveRespondProfile() {
    return { profile: null, status: "unmatched", method: "none" };
  },
  toIsoFromRespondTimestamp(value) {
    return new Date(Number(value)).toISOString();
  },
};

const harnessSource = source.replace(
  /import \{[\s\S]*?\} from "\.\/workCenter";/,
  "const { resolveRespondProfile, toIsoFromRespondTimestamp } = globalThis.__respondSyncTestDeps;",
);
const {
  RESPOND_MESSAGE_PAGE_LIMIT,
  buildRespondSnapshot,
} = await import(`data:text/javascript;base64,${Buffer.from(harnessSource).toString("base64")}`);

const existingSnapshot = {
  respond_contact_id: "qa-contact",
  respond_last_inbound_at: "2026-08-13T20:00:00.000Z",
  respond_last_outbound_at: "2026-08-13T19:00:00.000Z",
  respond_unanswered_since: "2026-08-13T20:00:00.000Z",
};
const contact = (status) => ({
  id: "qa-contact",
  status,
  assignee: null,
  custom_fields: [],
});

test("conversación cerrada elimina unanswered aunque el último mensaje siga siendo inbound", () => {
  const snapshot = buildRespondSnapshot({
    contact: contact("closed"),
    messages: [],
    profiles: [],
    existingSnapshot,
  });
  assert.equal(snapshot.respond_conversation_status, "closed");
  assert.equal(snapshot.respond_last_inbound_at, existingSnapshot.respond_last_inbound_at);
  assert.equal(snapshot.respond_unanswered_since, null);
});

test("todo estado distinto de open elimina unanswered", () => {
  for (const status of ["closed", "done", null]) {
    const snapshot = buildRespondSnapshot({
      contact: contact(status),
      messages: [],
      profiles: [],
      existingSnapshot,
    });
    assert.equal(snapshot.respond_unanswered_since, null);
  }
});

test("conversación abierta conserva unanswered cuando inbound es posterior", () => {
  const snapshot = buildRespondSnapshot({
    contact: contact("open"),
    messages: [],
    profiles: [],
    existingSnapshot,
  });
  assert.equal(snapshot.respond_unanswered_since, existingSnapshot.respond_last_inbound_at);
});

test("el límite de lectura de mensajes continúa en 50", () => {
  assert.equal(RESPOND_MESSAGE_PAGE_LIMIT, 50);
});
