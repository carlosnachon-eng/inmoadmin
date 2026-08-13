import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperSource = await readFile(
  new URL("../lib/ejecutivo/managementIntervention.js", import.meta.url),
  "utf8",
);
const componentSource = await readFile(
  new URL("../components/ejecutivo/WorkCenterView.js", import.meta.url),
  "utf8",
);
const workCenterApiSource = await readFile(
  new URL("../pages/api/ejecutivo/work-center.js", import.meta.url),
  "utf8",
);
const interventionApiSource = await readFile(
  new URL("../pages/api/ejecutivo/management-intervention.js", import.meta.url),
  "utf8",
);
const interventionMigrationSource = await readFile(
  new URL("../supabase/migrations/202608080007_fase_2a_production_hardening.sql", import.meta.url),
  "utf8",
);

const {
  MANAGEMENT_AUTO_REFRESH_MS,
  SESSION_EXPIRED_MESSAGE,
  requestManagementIntervention,
  resolveInterventionSignalState,
  subscribeVisibleRefresh,
} = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);

const response = (status, body = {}) => ({ status, async json() { return body; } });

test("un 401 refresca sesión y reintenta exactamente una vez", async () => {
  const requests = [];
  let refreshCalls = 0;
  const result = await requestManagementIntervention({
    accessToken: "expired-token",
    method: "POST",
    body: { contextKey: "qa:stable" },
    refreshSession: async () => {
      refreshCalls += 1;
      return { data: { session: { access_token: "fresh-token" } } };
    },
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return requests.length === 1 ? response(401) : response(200, { ok: true });
    },
  });

  assert.equal(result.response.status, 200);
  assert.equal(refreshCalls, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, "Bearer expired-token");
  assert.equal(requests[1].headers.Authorization, "Bearer fresh-token");
  assert.equal(requests[0].body, requests[1].body);
});

test("un segundo 401 informa sesión expirada y no intenta una tercera vez", async () => {
  let requests = 0;
  let refreshCalls = 0;
  await assert.rejects(
    requestManagementIntervention({
      accessToken: "expired-token",
      method: "PATCH",
      body: { interventionId: "qa-intervention" },
      refreshSession: async () => {
        refreshCalls += 1;
        return { data: { session: { access_token: "still-invalid" } } };
      },
      fetchImpl: async () => {
        requests += 1;
        return response(401);
      },
    }),
    (error) => error.code === "session_expired" && error.message === SESSION_EXPIRED_MESSAGE,
  );
  assert.equal(refreshCalls, 1);
  assert.equal(requests, 2);
});

test("403, 409 y 500 no disparan refresh ni retry", async () => {
  for (const status of [403, 409, 500]) {
    let requests = 0;
    let refreshCalls = 0;
    const result = await requestManagementIntervention({
      accessToken: "valid-token",
      method: "POST",
      body: { contextKey: "qa:stable" },
      refreshSession: async () => {
        refreshCalls += 1;
        return { data: { session: { access_token: "unused" } } };
      },
      fetchImpl: async () => {
        requests += 1;
        return response(status, { error: `status ${status}` });
      },
    });
    assert.equal(result.response.status, status);
    assert.equal(requests, 1);
    assert.equal(refreshCalls, 0);
  }
});

test("refocus y polling visible refrescan; pestaña oculta suspende polling", async () => {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const intervals = new Map();
  const cleared = [];
  let nextIntervalId = 1;
  let refreshCalls = 0;
  const documentObject = {
    visibilityState: "visible",
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  const windowObject = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const cleanup = subscribeVisibleRefresh({
    refresh: async () => { refreshCalls += 1; },
    windowObject,
    documentObject,
    setIntervalFn(callback, intervalMs) {
      assert.equal(intervalMs, MANAGEMENT_AUTO_REFRESH_MS);
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, callback);
      return id;
    },
    clearIntervalFn(id) {
      cleared.push(id);
      intervals.delete(id);
    },
  });

  assert.equal(intervals.size, 1);
  intervals.values().next().value();
  await new Promise((resolve) => setImmediate(resolve));
  windowListeners.get("focus")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 2);

  documentObject.visibilityState = "hidden";
  documentListeners.get("visibilitychange")();
  assert.equal(intervals.size, 0);
  assert.equal(cleared.length, 1);
  windowListeners.get("focus")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 2);

  documentObject.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 3);
  assert.equal(intervals.size, 1);
  cleanup();
  assert.equal(intervals.size, 0);
});

test("sin_respuesta distingue señal activa, resuelta y no determinable", () => {
  const intervention = {
    indicators: { signalType: "sin_respuesta", respondContactId: "contact-1" },
  };
  assert.equal(resolveInterventionSignalState(intervention, new Map([
    ["contact-1", { respond_conversation_status: "open", respond_unanswered_since: "2026-08-13T15:00:00Z" }],
  ])).state, "active");
  assert.equal(resolveInterventionSignalState(intervention, new Map([
    ["contact-1", { respond_conversation_status: "closed", respond_unanswered_since: "2026-08-13T15:00:00Z" }],
  ])).state, "resolved");
  assert.equal(resolveInterventionSignalState(intervention, new Map([
    ["contact-1", { respond_conversation_status: "open", respond_unanswered_since: null }],
  ])).state, "resolved");
  assert.equal(resolveInterventionSignalState(intervention, new Map()).state, "undetermined");
});

test("UI muestra estado actual y Registrar revisión sin cerrar automáticamente", () => {
  assert.match(componentSource, /subscribeVisibleRefresh/);
  assert.match(componentSource, /Registrar revisión/);
  assert.match(componentSource, /Señal activa/);
  assert.match(componentSource, /Señal resuelta/);
  assert.match(workCenterApiSource, /signalState:/);
  assert.doesNotMatch(workCenterApiSource, /signalState:[\s\S]{0,400}review_management_intervention/);
});

test("contextKey e índice activo conservan la deduplicación existente", () => {
  assert.match(interventionApiSource, /contextKey/);
  assert.match(interventionApiSource, /duplicate: true/);
  assert.match(interventionMigrationSource, /uq_gv_management_interventions_active_context/);
});
