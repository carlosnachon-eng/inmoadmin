import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../lib/ejecutivo/respondSync.js", import.meta.url),
  "utf8",
);
const fixture = JSON.parse(await readFile(
  new URL("./fixtures/respondCanonicalCurrentState.json", import.meta.url),
  "utf8",
));

globalThis.__respondCanonicalTestDeps = {
  resolveRespondProfile(assignee, profiles) {
    const email = String(assignee?.email || "").trim().toLowerCase();
    const profile = (profiles || []).find(
      (candidate) => String(candidate.email || "").trim().toLowerCase() === email,
    ) || null;
    return profile
      ? { profile, status: "matched", method: "email_exact" }
      : { profile: null, status: assignee?.id ? "unmatched" : "unmatched", method: "none" };
  },
  toIsoFromRespondTimestamp(value) {
    const raw = Number(value);
    const milliseconds = raw > 1e14 ? Math.floor(raw / 1000) : raw;
    return new Date(milliseconds).toISOString();
  },
};

const harnessSource = source.replace(
  /import \{[\s\S]*?\} from "\.\/workCenter";/,
  "const { resolveRespondProfile, toIsoFromRespondTimestamp } = globalThis.__respondCanonicalTestDeps;",
);
const respondSync = await import(
  `data:text/javascript;base64,${Buffer.from(harnessSource).toString("base64")}`
);

const {
  RESPOND_MESSAGE_PAGE_LIMIT,
  buildRespondSnapshot,
  latestRespondRelevantMessage,
  readRespondMessages,
} = respondSync;

const advisorProfile = {
  id: "profile-advisor-qa",
  email: "advisor.qa@example.invalid",
  role_id: "asesor",
  active: true,
};
const oldAdvisorProfile = {
  id: "profile-old-advisor-qa",
  email: "old-advisor.qa@example.invalid",
  role_id: "asesor",
  active: true,
};
const staleExistingSnapshot = {
  respond_contact_id: fixture.contact.id,
  respond_assignee_id: "respond-user-deleted",
  respond_assignee_email: "old-advisor.qa@example.invalid",
  mapped_profile_id: oldAdvisorProfile.id,
  mapping_status: "matched",
  respond_last_inbound_at: "2026-08-13T20:00:00.000Z",
  respond_last_outbound_at: "2026-08-13T15:00:00.000Z",
  respond_unanswered_since: "2026-08-13T20:00:00.000Z",
};

function build({ contact = fixture.contact, messages = [], existingSnapshot = null, profiles = [] } = {}) {
  return buildRespondSnapshot({
    contact,
    messages,
    profiles,
    existingSnapshot,
    messagePagesRead: 1,
  });
}

test("inbound más reciente establece unanswered desde ese inbound", () => {
  const snapshot = build({ messages: fixture.messages.inboundLatest });
  assert.equal(snapshot.respond_unanswered_since, "2026-08-13T16:00:00.000Z");
  assert.equal(snapshot.respond_last_inbound_at, "2026-08-13T16:00:00.000Z");
});

test("outbound más reciente limpia unanswered aunque el snapshot anterior esté stale", () => {
  const snapshot = build({
    messages: fixture.messages.outboundLatest,
    existingSnapshot: staleExistingSnapshot,
  });
  assert.equal(snapshot.respond_unanswered_since, null);
  assert.equal(snapshot.respond_last_outbound_at, "2026-08-13T17:00:00.000Z");
});

test("múltiples mensajes desordenados usan el timestamp real más reciente", () => {
  const messages = [
    fixture.messages.outboundLatest[1],
    fixture.messages.outboundLatest[0],
    { ...fixture.messages.inboundLatest[0], timestamp: "2026-08-13T14:00:00.000Z" },
  ];
  const latest = latestRespondRelevantMessage(messages);
  assert.equal(latest.direction, "outgoing");
  assert.equal(latest.timestamp, "2026-08-13T17:00:00.000Z");
});

test("frontera de página avanza solo si la página reciente no aporta dirección relevante", async () => {
  process.env.RESPOND_IO_TOKEN = "qa";
  const originalFetch = globalThis.fetch;
  const requests = [];
  const responses = [
    {
      items: fixture.messages.unsupportedOnly,
      pagination: { next: "https://api.respond.io/v2/contact/id:qa/message/list?limit=50&cursorId=2" },
    },
    {
      items: [fixture.messages.outboundLatest[1]],
      pagination: { next: null },
    },
  ];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await readRespondMessages("qa", 3);
    assert.equal(result.pagesRead, 2);
    assert.equal(result.messageRequests, 2);
    assert.equal(latestRespondRelevantMessage(result.messages).direction, "outgoing");
    assert.equal(new URL(requests[0]).searchParams.get("limit"), "50");
    assert.equal(new URL(requests[1]).searchParams.get("limit"), "50");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("la primera página reciente basta aunque contenga ambos sentidos", async () => {
  process.env.RESPOND_IO_TOKEN = "qa";
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      items: fixture.messages.outboundLatest,
      pagination: { next: "https://api.respond.io/v2/contact/id:qa/message/list?limit=50&cursorId=older" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await readRespondMessages("qa", 3);
    assert.equal(requests, 1);
    assert.equal(result.pagesRead, 1);
    assert.equal(latestRespondRelevantMessage(result.messages).direction, "outgoing");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conversación cerrada siempre limpia unanswered", () => {
  const snapshot = build({
    contact: { ...fixture.contact, status: "closed" },
    messages: fixture.messages.inboundLatest,
    existingSnapshot: staleExistingSnapshot,
  });
  assert.equal(snapshot.respond_conversation_status, "closed");
  assert.equal(snapshot.respond_unanswered_since, null);
});

test("assignee conocido usa el mapping actual", () => {
  const snapshot = build({
    contact: { ...fixture.contact, assignee: fixture.assignees.known },
    profiles: [advisorProfile, oldAdvisorProfile],
    existingSnapshot: staleExistingSnapshot,
  });
  assert.equal(snapshot.respond_assignee_id, fixture.assignees.known.id);
  assert.equal(snapshot.mapped_profile_id, advisorProfile.id);
  assert.equal(snapshot.mapping_status, "matched");
});

test("cambio conocido a Unassigned limpia identidad y mapping anteriores", () => {
  const snapshot = build({
    contact: { ...fixture.contact, assignee: fixture.assignees.unassigned },
    profiles: [oldAdvisorProfile],
    existingSnapshot: staleExistingSnapshot,
  });
  assert.equal(snapshot.respond_assignee_id, null);
  assert.equal(snapshot.respond_assignee_email, null);
  assert.equal(snapshot.mapped_profile_id, null);
  assert.equal(snapshot.metadata.mapping_method, "current_assignee_unassigned");
});

test("cambio conocido a Deleted User no conserva mapping histórico", () => {
  const snapshot = build({
    contact: { ...fixture.contact, assignee: fixture.assignees.deleted },
    profiles: [oldAdvisorProfile],
    existingSnapshot: staleExistingSnapshot,
  });
  assert.equal(snapshot.respond_assignee_id, null);
  assert.equal(snapshot.respond_assignee_email, null);
  assert.equal(snapshot.mapped_profile_id, null);
  assert.equal(snapshot.metadata.mapping_method, "current_assignee_deleted");
});

test("cambio Unassigned a usuario conocido establece el mapping nuevo", () => {
  const snapshot = build({
    contact: { ...fixture.contact, assignee: fixture.assignees.known },
    profiles: [advisorProfile],
    existingSnapshot: {
      ...staleExistingSnapshot,
      respond_assignee_id: null,
      respond_assignee_email: null,
      mapped_profile_id: null,
    },
  });
  assert.equal(snapshot.respond_assignee_id, fixture.assignees.known.id);
  assert.equal(snapshot.mapped_profile_id, advisorProfile.id);
});

test("reproduce los 19 unanswered stale: latest outbound limpia todos", () => {
  for (let index = 0; index < 19; index += 1) {
    const snapshot = build({
      contact: { ...fixture.contact, id: `qa-unanswered-${index + 1}` },
      messages: fixture.messages.outboundLatest,
      existingSnapshot: {
        ...staleExistingSnapshot,
        respond_contact_id: `qa-unanswered-${index + 1}`,
      },
    });
    assert.equal(snapshot.respond_unanswered_since, null);
  }
});

test("reproduce los 7 mappings stale: ausencia/eliminación actual limpia todos", () => {
  const currentAssignees = [
    null,
    fixture.assignees.deleted,
    { id: "deleted-2", firstName: "Deleted", lastName: "User" },
    { id: "deleted-3", status: "deleted" },
    { id: "deleted-4", isDeleted: true },
    { id: "deleted-5", deleted_at: "2026-08-13T00:00:00.000Z" },
    { name: "Unassigned" },
  ];
  for (const assignee of currentAssignees) {
    const snapshot = build({
      contact: { ...fixture.contact, assignee },
      profiles: [oldAdvisorProfile],
      existingSnapshot: staleExistingSnapshot,
    });
    assert.equal(snapshot.respond_assignee_id, null);
    assert.equal(snapshot.respond_assignee_email, null);
    assert.equal(snapshot.mapped_profile_id, null);
  }
});

test("sales_relevant, active/blocked y metadata-only no sufren regresión", () => {
  const commercial = build({
    contact: { ...fixture.contact, assignee: fixture.assignees.known, firstName: "QA" },
    profiles: [advisorProfile],
  });
  assert.equal(commercial.sales_relevant, true);
  assert.equal(commercial.respond_record_active, true);
  assert.equal(commercial.respond_blocked, false);

  const nonCommercial = build({
    contact: {
      ...fixture.contact,
      firstName: "PII-QA",
      phone: "+0000000000",
      email: "contact.qa@example.invalid",
      assignee: null,
    },
  });
  assert.equal(nonCommercial.sales_relevant, false);
  assert.equal(nonCommercial.respond_record_active, true);
  assert.equal(nonCommercial.respond_blocked, false);
  assert.equal(nonCommercial.metadata.contact_name, undefined);
  assert.doesNotMatch(JSON.stringify(nonCommercial.metadata), /PII-QA|\+0000000000|contact\.qa/);

  const blocked = build({
    contact: { ...fixture.contact, assignee: fixture.assignees.known, blocked: true },
    profiles: [advisorProfile],
  });
  assert.equal(blocked.sales_relevant, false);
  assert.equal(blocked.respond_record_active, true);
  assert.equal(blocked.respond_blocked, true);
});

test("el límite contractual de mensajes permanece en 50", () => {
  assert.equal(RESPOND_MESSAGE_PAGE_LIMIT, 50);
});
