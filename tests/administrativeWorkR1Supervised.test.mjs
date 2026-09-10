import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ADMIN_WORK_R1_HARD_CAP, administrativeWorkR1NotBefore, assertAdministrativeWorkR1Window,
} from "../lib/operaciones/durableAdministrativeWork.js";
import {
  administrativeWorkR1SourceEligible, planAdministrativeWorkR1,
} from "../lib/shadow/ai/administrativeWorkR1.js";

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = { SHADOW_ADMIN_WORK_R1_ENABLED: "true", SHADOW_ADMIN_WORK_R1_NOT_BEFORE: "2026-08-28T20:00:00.000Z" };
const envelope = { direction: "inbound", occurredAt: "2026-08-28T20:00:01.000Z", providerMetadata: { channelId: "544519", attachmentContext: { items: [] } } };
const context = { clientIdentityId: id(1), contractId: id(2), propertyId: id(3) };
const resolution = { case_domain: "maintenance", case_status: "existing_open_case", identity_context: { status: "trusted_link_available" }, interaction_direction: "inbound_customer_action", conflict_detected: false, technical_error: false, requires_human: false, missing_information: [], action_confidence: 0.95, domain_evidence: { maintenance: true }, context_contradiction: false };
const run = { id: id(4) }; const message = { id: id(5), external_message_id: "opaque-message" };
const migration = fs.readFileSync(new URL("../supabase/migrations/202608280006_administrative_work_r1_supervised_window.sql", import.meta.url), "utf8");
const stateMachine = fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js", import.meta.url), "utf8");
const implementation = fs.readFileSync(new URL("../lib/shadow/ai/administrativeWorkR1.js", import.meta.url), "utf8");

test("cutoff ausente e inválido fallan cerrado", () => {
  assert.equal(administrativeWorkR1NotBefore({}), null);
  assert.equal(administrativeWorkR1NotBefore({ SHADOW_ADMIN_WORK_R1_NOT_BEFORE: "hoy" }), null);
  assert.throws(() => assertAdministrativeWorkR1Window(envelope.occurredAt, { SHADOW_ADMIN_WORK_R1_ENABLED: "true" }), /not_before_invalid/);
});
test("backlog anterior al cutoff queda bloqueado", () => assert.throws(() => assertAdministrativeWorkR1Window("2026-08-28T19:59:59.000Z", env), /before_cutoff/));
test("evento posterior al cutoff es elegible", () => assert.equal(assertAdministrativeWorkR1Window(envelope.occurredAt, env).hardCap, 20));
test("hard cap inicial es inmutable en 20", () => assert.equal(ADMIN_WORK_R1_HARD_CAP, 20));
test("sólo canal Admin exacto es elegible", () => {
  assert.equal(administrativeWorkR1SourceEligible({ envelope, resolution, context, env }).eligible, true);
  assert.equal(administrativeWorkR1SourceEligible({ envelope: { ...envelope, providerMetadata: { channelId: "ventas" } }, resolution, context, env }).reason, "channel_not_allowlisted");
});
test("identidad no confirmed, conflicto y humano bloquean", () => {
  assert.equal(administrativeWorkR1SourceEligible({ envelope, resolution: { ...resolution, identity_context: { status: "candidate" } }, context, env }).reason, "identity_not_confirmed");
  assert.equal(administrativeWorkR1SourceEligible({ envelope, resolution: { ...resolution, conflict_detected: true }, context, env }).reason, "operational_context_unsafe");
  assert.equal(administrativeWorkR1SourceEligible({ envelope, resolution, context, humanResponseId: id(9), env }).reason, "human_override");
});
test("caso nuevo produce únicamente create durable con contexto canónico", () => {
  const plan = planAdministrativeWorkR1({ run, message, envelope, resolution, context, existingWork: null });
  assert.equal(plan.action, "create_administrative_pending");
  assert.equal(plan.input.clientIdentityId, context.clientIdentityId);
  assert.equal(plan.input.contractId, context.contractId);
  assert.equal(plan.input.sourceType, "whatsapp");
});
test("evidencia interpretada actualiza caso existente sin binario", () => {
  const mediaEnvelope = { ...envelope, providerMetadata: { ...envelope.providerMetadata, attachmentContext: { items: [{ interpretation: { interpretationStatus: "completed" } }] } } };
  const plan = planAdministrativeWorkR1({ run, message, envelope: mediaEnvelope, resolution, context, existingWork: { id: id(8), status: "open" } });
  assert.equal(plan.action, "link_received_evidence");
  assert.equal(plan.input.referenceType, "shadow_message");
  assert.equal("url" in plan.input, false);
});
test("pago ya registrado conserva comisión pendiente sin repetir pago", () => {
  const payment = { ...resolution, case_domain: "payment", payment_state: { commission_status: "pending" }, requires_human: true };
  const plan = planAdministrativeWorkR1({ run, message, envelope, resolution: payment, context, existingWork: null, currentPaymentState: { paymentRecorded: true } });
  assert.equal(plan.action, "create_administrative_pending");
  assert.equal(plan.input.requiresAuthorization, true);
  assert.match(plan.input.nextStep, /pago ya aparece registrado/i);
  assert.match(plan.input.nextStep, /no asumir qui[eé]n/i);
  assert.doesNotMatch(JSON.stringify(plan), /payment_confirmed|saldo liquidado/i);
});
test("cada run produce una sola acción y una sola unidad de cap", () => {
  const plan = planAdministrativeWorkR1({ run, message, envelope, resolution, context, existingWork: null });
  assert.equal(plan.idempotencyKey, `ai:r1:${run.id}`);
  assert.equal(Array.isArray(plan), false);
});
test("RPC aplica cutoff, lock, cap e idempotencia antes de escribir", () => {
  assert.match(migration, /p_source_occurred_at < p_not_before/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_count >= p_hard_cap/);
  assert.match(migration, /idempotency_key=btrim\(p_idempotency_key\)/);
});
test("RPC legacy deja de ser accesible a service_role", () => {
  assert.match(migration, /revoke all on function public\.execute_administrative_work_r1\(text,jsonb,text,text,uuid\)/);
  assert.match(migration, /grant execute on function public\.execute_administrative_work_r1_supervised/);
});
test("Auto-Real invoca R1 sólo después de resolución operacional", () => {
  assert.match(stateMachine, /maybeExecuteAdministrativeWorkR1/);
  assert.match(stateMachine, /finalDecision\.operational_resolution/);
  assert.match(stateMachine, /input_mode === "auto_real_shadow"/);
});
test("implementación no escribe pagos, tickets, contratos, Respond ni outbound", () => {
  assert.doesNotMatch(implementation, /\.from\("(?:payments|maintenance_tickets|contracts|properties)"\)\.(?:insert|update|upsert|delete)/);
  assert.doesNotMatch(implementation, /respond.*(?:send|write)|outbound|payment_confirmed/i);
});
