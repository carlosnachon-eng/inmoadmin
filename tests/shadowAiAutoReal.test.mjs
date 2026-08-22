import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AUTO_REAL_MAX_TURNS_PER_INVOCATION, assertAutoRealEnvironment, autoRealRunDisposition, estimateAutoRealVolume } from "../lib/shadow/ai/autoReal.js";
import { buildRealShadowConversationTurns, realShadowTurnEnvelope } from "../lib/shadow/ai/conversationTurns.js";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const conversation = { id: "c1", provider: "respond_admin", channel: "544519" };
const msg = (id, direction, minute, text = `mensaje ${id}`, metadata = {}) => ({ id, conversation_id: "c1", direction, occurred_at: `2026-08-21T12:${String(minute).padStart(2,"0")}:00Z`, sanitized_text: text, attachment_metadata: [], provider_metadata: metadata, external_message_id: `opaque-${id}` });
const env = { SHADOW_RESPOND_ADMIN_CHANNEL_ID: "544519" };
const prodAutoEnv = { VERCEL_ENV:"production",SUPABASE_ENVIRONMENT:"production",NEXT_PUBLIC_SUPABASE_URL:"https://bnzrnizrmonjxlktbhlp.supabase.co",SHADOW_AI_AUTO_REAL_ENABLED:"true",SHADOW_AI_ENABLED:"false",SHADOW_AI_PRODUCTION_ENABLED:"false",SHADOW_AI_ALLOW_REAL_MESSAGES:"false",SHADOW_AI_ALLOW_OPERATIONAL_EVENTS:"false",SHADOW_OUTBOUND_ENABLED:"false" };

test("tres inbound consecutivos forman un solo turn", () => {
  const turns = buildRealShadowConversationTurns({ messages:[msg("a","inbound",0),msg("b","inbound",1),msg("c","inbound",2)], conversations:[conversation], env, now:Date.parse("2026-08-21T12:10:00Z") });
  assert.equal(turns.length,1); assert.deepEqual(turns[0].messageIds,["a","b","c"]); assert.equal(turns[0].sanitizedText,"mensaje a\nmensaje b\nmensaje c");
});

test("respuesta humana separa dos turnos y nunca entra al contexto anterior", () => {
  const turns = buildRealShadowConversationTurns({ messages:[msg("a","inbound",0,"Hola"),msg("h","outbound_human",1,"respuesta futura"),msg("b","inbound",2,"Otra consulta")], conversations:[conversation], env, now:Date.parse("2026-08-21T12:10:00Z") });
  assert.equal(turns.length,2); assert.equal(turns[0].humanResponseId,"h"); assert.equal(turns[0].sanitizedText,"Hola"); assert.doesNotMatch(turns[0].sanitizedText,/respuesta futura/); assert.deepEqual(turns[1].messageIds,["b"]);
});

test("Ventas, QA y turn no asentado quedan excluidos", () => {
  assert.equal(buildRealShadowConversationTurns({ messages:[msg("a","inbound",0)], conversations:[{...conversation,channel:"498219"}], env, now:Date.parse("2026-08-21T12:10:00Z") }).length,0);
  assert.equal(buildRealShadowConversationTurns({ messages:[msg("q","inbound",0,"FASE2A-QA")], conversations:[conversation], env, now:Date.parse("2026-08-21T12:10:00Z") }).length,0);
  assert.equal(buildRealShadowConversationTurns({ messages:[msg("a","inbound",9)], conversations:[conversation], env, now:Date.parse("2026-08-21T12:10:00Z") }).length,0);
});

test("turn usa identidad estable y envelope no contiene respuesta humana", () => {
  const [turn] = buildRealShadowConversationTurns({ messages:[msg("a","inbound",0),msg("h","outbound_human",1,"humano")], conversations:[conversation], env, now:Date.parse("2026-08-21T12:10:00Z") });
  const again = buildRealShadowConversationTurns({ messages:[msg("a","inbound",0),msg("h","outbound_human",1,"humano")], conversations:[conversation], env, now:Date.parse("2026-08-21T12:20:00Z") })[0];
  assert.equal(turn.turnKey,again.turnKey); const envelope=realShadowTurnEnvelope(turn,conversation); assert.equal(envelope.sanitizedText,"mensaje a"); assert.doesNotMatch(JSON.stringify(envelope),/humano/);
});

test("completed/running/error-timeout conservan idempotencia sin retry", () => {
  assert.equal(autoRealRunDisposition(null),"pending"); assert.equal(autoRealRunDisposition({status:"completed"}),"skip_completed"); assert.equal(autoRealRunDisposition({status:"running"}),"block_running");
  assert.equal(autoRealRunDisposition({status:"error"}),"report_failed_no_retry"); assert.equal(autoRealRunDisposition({status:"timeout"}),"report_failed_no_retry");
});

test("kill switch es independiente, global AI permanece OFF y outbound/operational bloquean", () => {
  assert.equal(assertAutoRealEnvironment(prodAutoEnv).projectRef,"bnzrnizrmonjxlktbhlp");
  for(const override of [{SHADOW_AI_AUTO_REAL_ENABLED:"false"},{SHADOW_AI_ENABLED:"true"},{SHADOW_AI_ALLOW_REAL_MESSAGES:"true"},{SHADOW_OUTBOUND_ENABLED:"true"},{SHADOW_AI_ALLOW_OPERATIONAL_EVENTS:"true"},{NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co"}]) assert.throws(()=>assertAutoRealEnvironment({...prodAutoEnv,...override}));
});

test("procesamiento limita concurrencia a un turn por invocation y no tiene retries automáticos", () => {
  assert.equal(AUTO_REAL_MAX_TURNS_PER_INVOCATION,1);
  const source=read("lib/shadow/ai/autoReal.js"); assert.match(source,/allowRetry: false/); assert.match(source,/if \(running\) return \{ status: "running"/); assert.doesNotMatch(source,/Promise\.all\([^)]*startAutoRealTurn|retryAuthorization/);
});

test("auto endpoint no responde, escribe ERP ni procesa Operational Events", () => {
  const sources=[read("pages/api/cron/shadow-ai-real-auto.js"),read("pages/api/operaciones/shadow-ai-real-backfill.js"),read("lib/shadow/ai/autoReal.js")].join("\n");
  assert.doesNotMatch(sources,/sendMessage|respond\.io|maintenance_tickets.*(?:insert|update)|shadow_operational_events.*start/i);
  assert.match(sources,/SHADOW_AI_ALLOW_OPERATIONAL_EVENTS/); assert.match(sources,/SHADOW_OUTBOUND_ENABLED/);
});

test("estimación de volumen entrega tokens y costo antes del backfill", () => {
  const estimate=estimateAutoRealVolume([{disposition:"pending"},{disposition:"skip_completed"}]); assert.equal(estimate.pendingTurns,1); assert.ok(estimate.inputTokens>0); assert.ok(estimate.estimatedCostUsd>0);
});
