import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ADMIN_WORK_R0_TOOLS, ADMIN_WORK_R1_ACTIONS, administrativeWorkR1Enabled,
  executeAdministrativeWorkR1, validateAdministrativeWorkR1,
} from "../lib/operaciones/durableAdministrativeWork.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/202608280005_administrative_work_durable_r1.sql", import.meta.url), "utf8");
const checks = fs.readFileSync(new URL("../supabase/migrations/202608280005_administrative_work_durable_r1_checks.sql", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../pages/api/operaciones/administrative-work.js", import.meta.url), "utf8");
const workCenter = fs.readFileSync(new URL("../pages/api/operaciones/work-center.js", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../pages/mi-trabajo-administrativo.js", import.meta.url), "utf8");

const id = "10000000-0000-4000-8000-000000000001";
test("R0 contiene exclusivamente siete tools read-only", () => assert.deepEqual(ADMIN_WORK_R0_TOOLS, ["list_administrative_work","get_administrative_work","find_administrative_work_by_context","find_possible_duplicate_work","get_administrative_work_history","get_administrative_evidence_summary","get_pending_approvals"]));
test("R1 contiene exclusivamente ocho acciones reversibles", () => assert.equal(ADMIN_WORK_R1_ACTIONS.length, 8));
test("R1 está OFF por defecto e independiente de outbound", () => { assert.equal(administrativeWorkR1Enabled({}), false); assert.equal(administrativeWorkR1Enabled({ SHADOW_ADMIN_WORK_R1_ENABLED: "true", SHADOW_OUTBOUND_ENABLED: "false" }), true); });
test("create pending exige dedupe y contexto acotado", () => assert.equal(validateAdministrativeWorkR1("create_administrative_pending", { domain: "maintenance", workType: "maintenance_followup", title: "Seguimiento", dedupeKey: "maintenance:fixture", sourceType: "internal_event", sourceId: "fixture:source" }).dedupeKey, "maintenance:fixture"));
test("notas financieras o de cierre quedan bloqueadas", () => assert.throws(() => validateAdministrativeWorkR1("append_structured_internal_note", { workItemId: id, note: "Pago confirmado y saldo liquidado" }), /invalid_r1_payload/));
test("followup inválido falla cerrado", () => assert.throws(() => validateAdministrativeWorkR1("schedule_nonfinancial_follow_up", { workItemId: id, followupAt: "mañana" }), /invalid_r1_payload/));
test("asignación exige UUID", () => assert.throws(() => validateAdministrativeWorkR1("assign_operational_responsible", { workItemId: id, responsibleProfileId: "admin" }), /invalid_r1_payload/));
test("flag OFF impide siquiera llamar RPC", async () => { let calls = 0; await assert.rejects(() => executeAdministrativeWorkR1({ rpc: async () => { calls += 1; } }, { action: "mark_information_received", input: { workItemId: id }, idempotencyKey: "fixture:key:0001", actorProfileId: id }, {}), /admin_work_r1_disabled/); assert.equal(calls, 0); });
test("RPC supervisada es única frontera mutativa y conserva actor", async () => { let payload; const db = { rpc: async (name, args) => { payload = { name, args }; return { data: { work_item_id: id }, error: null }; } }; await executeAdministrativeWorkR1(db, { action: "mark_information_received", input: { workItemId: id }, idempotencyKey: "fixture:key:0002", actorProfileId: id, sourceOccurredAt: "2026-08-28T20:00:01.000Z" }, { SHADOW_ADMIN_WORK_R1_ENABLED: "true", SHADOW_ADMIN_WORK_R1_NOT_BEFORE: "2026-08-28T20:00:00.000Z" }); assert.equal(payload.name, "execute_administrative_work_r1_supervised"); assert.equal(payload.args.p_actor_type, "human"); assert.equal(payload.args.p_hard_cap, 20); });
test("schema durable cubre items, fuentes, evidencia, historial y aprobaciones", () => ["administrative_work_items","administrative_work_source_links","administrative_work_evidence","administrative_work_history","administrative_work_approvals"].forEach((name) => assert.match(migration, new RegExp(`create table public\\.${name}`))));
test("historial es append-only y RLS está activo", () => { assert.match(migration, /alter table public\.administrative_work_history enable row level security/); assert.doesNotMatch(migration, /grant (?:update|delete).*administrative_work_history/i); });
test("grants revocan defaults y no conceden DELETE TRUNCATE", () => { assert.match(migration, /revoke all on public\.administrative_work_items[\s\S]*from public,anon,authenticated,service_role/); assert.doesNotMatch(migration, /grant delete|grant truncate/i); });
test("RPC bloquea acciones fuera de R1 y estados terminales", () => { assert.match(migration, /r1_action_not_allowlisted/); assert.match(migration, /r1_terminal_work_blocked/); });
test("deduplicación e idempotencia están impuestas en DB", () => { assert.match(migration, /dedupe_key text not null unique/); assert.match(migration, /idempotency_key text not null unique/); });
test("no existen seeds ni backfill", () => { assert.doesNotMatch(migration, /insert into public\.administrative_work_items\s*\([^)]*\)\s*values\s*\([^p]/i); assert.match(checks, /migration must not seed\/backfill/); });
test("endpoint es admin-only, same-origin y no expone R1 a Auto-Real", () => { assert.match(api, /isAdministrativeWorkCenterRole/); assert.match(api, /sameOriginAdminRequest/); assert.doesNotMatch(api, /Respond|send_message|whatsapp/i); });
test("Work Center conserva derivado y agrega durable incremental", () => { assert.match(workCenter, /\.\.\.durableItems, \.\.\.workCenter\.items/); assert.match(workCenter, /3C-WORK-DURABLE-R1/); });
test("UI muestra origen durable y estado de capability", () => { assert.match(ui, /Trabajo Administrativo durable/); assert.match(ui, /R1 .*apagado · sólo lectura/); });
test("R1 no contiene escrituras de pagos, tickets o Respond", () => { const source = fs.readFileSync(new URL("../lib/operaciones/durableAdministrativeWork.js", import.meta.url), "utf8"); assert.doesNotMatch(source, /payments|maintenance_tickets|respond|whatsapp|auth\.users/i); });
test("checks validan RLS, grants y cero datos iniciales", () => { assert.match(checks, /relrowsecurity/); assert.match(checks, /has_table_privilege/); assert.match(checks, /exists\(select 1 from public\.administrative_work_items\)/); });
