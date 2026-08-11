import assert from "node:assert/strict";
import test from "node:test";

import {
  INSTITUTIONAL_NOTIFICATION_RECIPIENTS,
  mergeUniqueEmails,
  resolveCoordinationNotificationRecipients,
} from "../lib/coordinationNotificationRecipients.mjs";

const queryFor = ({ data = [], error = null } = {}) => {
  const calls = [];
  const query = {
    select(value) { calls.push(["select", value]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    order(column, options) {
      calls.push(["order", column, options]);
      return Promise.resolve({ data, error });
    },
  };

  return {
    client: { from(table) { calls.push(["from", table]); return query; } },
    calls,
  };
};

test("A: incluye a Marisol activa por coord_operaciones", async () => {
  const { client } = queryFor({ data: [{ email: "marisol@example.com" }] });
  const result = await resolveCoordinationNotificationRecipients(client);
  assert.deepEqual(result.recipients, [...INSTITUTIONAL_NOTIFICATION_RECIPIENTS, "marisol@example.com"]);
});

test("B: incluye temporalmente a dos perfiles activos del rol", async () => {
  const { client } = queryFor({ data: [{ email: "marisol@example.com" }, { email: "tania@example.com" }] });
  const result = await resolveCoordinationNotificationRecipients(client);
  assert.deepEqual(result.coordinationEmails, ["marisol@example.com", "tania@example.com"]);
});

test("C: un perfil inactivo deja de llegar porque la consulta exige active=true", async () => {
  const { client, calls } = queryFor({ data: [{ email: "marisol@example.com" }] });
  const result = await resolveCoordinationNotificationRecipients(client);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "active" && call[2] === true));
  assert.ok(!result.recipients.includes("tania@example.com"));
});

test("D y E: ignora emails vacíos y deduplica coincidencias exactas", async () => {
  const { client } = queryFor({
    data: [
      { email: null },
      { email: "" },
      { email: " MARISOL@example.com " },
      { email: "marisol@example.com" },
    ],
  });
  const result = await resolveCoordinationNotificationRecipients(client);
  assert.deepEqual(result.coordinationEmails, ["marisol@example.com"]);
  assert.deepEqual(mergeUniqueEmails(["A@example.com", " a@example.com "]), ["a@example.com"]);
});

test("F: ante falla conserva solo destinatarios institucionales y registra advertencia", async () => {
  const warnings = [];
  const { client } = queryFor({ error: { message: "profiles unavailable" } });
  const result = await resolveCoordinationNotificationRecipients(client, {
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.deepEqual(result.recipients, INSTITUTIONAL_NOTIFICATION_RECIPIENTS);
  assert.equal(result.source, "institutional_fallback");
  assert.equal(warnings.length, 1);
});
