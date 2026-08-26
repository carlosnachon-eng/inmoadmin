import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AUTO_REAL_MAX_TURNS_PER_INVOCATION, assertAutoRealEnvironment, autoRealRunDisposition, estimateAutoRealVolume, filterAutoRealTurnsByCutoff, parseAutoRealCutoff, selectAutoRealRun } from "../lib/shadow/ai/autoReal.js";
import { buildRealShadowConversationTurns, REAL_SHADOW_CONTEXT_MAX_CHARS, REAL_SHADOW_CONTEXT_MAX_MESSAGES, realShadowTurnEnvelope } from "../lib/shadow/ai/conversationTurns.js";
import { isRealShadowQaMessage } from "../lib/shadow/ai/realMessage.js";
import { minimalShadowAiContext } from "../lib/shadow/ai/runner.js";
import { createShadowAiInputSnapshot, inputEnvelopeForShadowAiRun } from "../lib/shadow/ai/stateMachine.js";
import { REAL_SHADOW_AUTO_AI_PROMPT_VERSION } from "../lib/shadow/ai/realPrompt.js";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const conversation = { id: "c1", provider: "respond_admin", channel: "544519" };
const msg = (id, direction, minute, text = `mensaje ${id}`, metadata = {}) => ({ id, conversation_id: "c1", direction, occurred_at: `2026-08-21T12:${String(minute).padStart(2,"0")}:00Z`, sanitized_text: text, attachment_metadata: [], provider_metadata: metadata, external_message_id: `opaque-${id}` });
const env = { SHADOW_RESPOND_ADMIN_CHANNEL_ID: "544519" };
const prodBaseEnv = { VERCEL_ENV:"production",SUPABASE_ENVIRONMENT:"production",NEXT_PUBLIC_SUPABASE_URL:"https://bnzrnizrmonjxlktbhlp.supabase.co",SHADOW_AI_ENABLED:"true",SHADOW_AI_PRODUCTION_ENABLED:"true",SHADOW_AI_ALLOW_REAL_MESSAGES:"true",SHADOW_AI_ALLOW_OPERATIONAL_EVENTS:"false",SHADOW_OUTBOUND_ENABLED:"false" };
const prodAutoEnv = { ...prodBaseEnv, SHADOW_AI_AUTO_REAL_ENABLED:"true", SHADOW_AI_BACKFILL_REAL_ENABLED:"false", SHADOW_AI_AUTO_REAL_NOT_BEFORE:"2026-08-22T15:00:00Z" };
const prodBackfillEnv = { ...prodBaseEnv, SHADOW_AI_AUTO_REAL_ENABLED:"false", SHADOW_AI_BACKFILL_REAL_ENABLED:"true" };

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

test("filtro QA excluye marcadores de smoke y metadata sintética en backfill y Auto-Real", () => {
  for (const message of [
    msg("q1","inbound",0,"PRUEBA SHADOW ADMIN 001"), msg("q2","inbound",0,"RECIBIDO SHADOW ADMIN 001"),
    msg("q3","inbound",0,"FASE2A-REAL-SMOKE"), msg("q4","inbound",0,"texto neutro",{ qa:true }),
    msg("q5","inbound",0,"texto neutro",{ nested:{ synthetic:true } }), msg("q6","inbound",0,"texto neutro",{ testMarker:"smoke" }),
  ]) assert.equal(isRealShadowQaMessage(message), true);
  assert.equal(isRealShadowQaMessage(msg("real","inbound",0,"Necesito apoyo con la renta",{ source:"respond" })), false);
});

test("turn breve recibe sólo contexto anterior sanitizado y nunca la respuesta humana posterior", () => {
  const messages=[
    msg("a","inbound",0,"La cita es en Montpellier"), msg("h1","outbound_human",1,"¿Confirmas que llegarás a las cuatro?"),
    msg("b","inbound",2,"Sí"), msg("h2","outbound_human",3,"Perfecto, gracias"),
    msg("c","inbound",4,"Voy diez minutos tarde"), msg("future","outbound_human",5,"Respuesta posterior secreta"),
  ];
  const turns=buildRealShadowConversationTurns({messages,conversations:[conversation],env,now:Date.parse("2026-08-21T12:10:00Z")});
  assert.equal(turns.length,3);
  assert.deepEqual(turns[1].priorContextMessages.map(x=>x.sanitizedText),["La cita es en Montpellier","¿Confirmas que llegarás a las cuatro?"]);
  const envelope=realShadowTurnEnvelope(turns[2],conversation);
  assert.match(JSON.stringify(envelope.providerMetadata.priorConversation),/Montpellier/);
  assert.match(JSON.stringify(envelope.providerMetadata.priorConversation),/Perfecto, gracias/);
  assert.doesNotMatch(JSON.stringify(envelope),/Respuesta posterior secreta/);
  assert.ok(envelope.providerMetadata.priorConversation.length<=REAL_SHADOW_CONTEXT_MAX_MESSAGES);
  assert.ok(JSON.stringify(envelope.providerMetadata.priorConversation).length<REAL_SHADOW_CONTEXT_MAX_CHARS+1000);
  assert.deepEqual(minimalShadowAiContext(envelope,{},[],0).metadata.priorConversation,envelope.providerMetadata.priorConversation);
});

test("contexto previo conserva asunto y referencias multiunidad sin mezclarlos con el turn actual", () => {
  const messages=[msg("a","inbound",0,"Envío comprobantes de las unidades A y B"),msg("h","outbound_human",1,"¿Confirmas que son renta de agosto?"),msg("b","inbound",2,"Sí, me apoyas con eso")];
  const turns=buildRealShadowConversationTurns({messages,conversations:[conversation],env,now:Date.parse("2026-08-21T12:10:00Z")});
  const envelope=realShadowTurnEnvelope(turns[1],conversation);
  assert.equal(envelope.sanitizedText,"Sí, me apoyas con eso");
  assert.match(JSON.stringify(envelope.providerMetadata.priorConversation),/unidades A y B/);
  assert.match(JSON.stringify(envelope.providerMetadata.priorConversation),/renta de agosto/);
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

test("prompt vigente no vuelve pendientes los turns reales ya completados con una versión anterior", () => {
  const legacy={id:"legacy",status:"completed",prompt_version:"administradora-ia-emporio-real-shadow-v1"};
  assert.equal(selectAutoRealRun([legacy])?.id,"legacy");
  const current={id:"current",status:"error",prompt_version:REAL_SHADOW_AUTO_AI_PROMPT_VERSION};
  assert.equal(selectAutoRealRun([legacy,current])?.id,"current");
});

test("prompt/runtime v4 distingue runs posteriores sin reanalizar completed o failed previos", () => {
  assert.equal(REAL_SHADOW_AUTO_AI_PROMPT_VERSION,"administradora-ia-emporio-real-shadow-v5");
  const completed={id:"completed-v2",status:"completed",prompt_version:"administradora-ia-emporio-real-shadow-v2"};
  const failed={id:"failed-v2",status:"timeout",prompt_version:"administradora-ia-emporio-real-shadow-v2"};
  assert.equal(selectAutoRealRun([completed])?.id,"completed-v2");
  assert.equal(selectAutoRealRun([failed])?.id,"failed-v2");
});

test("turn multimedia conserva marcadores y contexto no interpretado hasta Claude", () => {
  const media = { ...msg("media","inbound",0,"Te mando el comprobante\n[IMAGEN]"), attachment_metadata:[{ type:"image", mimeType:"image/jpeg", fileName:"omitido.jpg", referenceHash:"opaque" }] };
  const [turn] = buildRealShadowConversationTurns({ messages:[media], conversations:[conversation], env, now:Date.parse("2026-08-21T12:10:00Z") });
  const envelope = realShadowTurnEnvelope(turn, conversation);
  const snapshot = createShadowAiInputSnapshot(envelope);
  const modelInput = minimalShadowAiContext(snapshot, {}, [], 0);
  assert.equal(modelInput.message,"Te mando el comprobante\n[IMAGEN]");
  assert.deepEqual(modelInput.metadata.attachmentContext,{ present:true, interpreted:false, items:[{type:"image",mimeType:"image/jpeg"}] });
  assert.doesNotMatch(JSON.stringify(modelInput),/omitido\.jpg|opaque/);
});

test("regresión real sanitizada conserva turn completo y 932 caracteres previos hasta el input Claude", () => {
  const realConversation={id:"913f8fb8-d5d0-4310-a1b4-118a0bb40ecc",provider:"respond_admin",channel:"544519"};
  const realMessages=[
    { ...msg("prior-inbound","inbound",0,"x".repeat(11)),conversation_id:realConversation.id,occurred_at:"2026-08-22T15:00:15Z" },
    { ...msg("prior-human","outbound_human",0,"y".repeat(921)),conversation_id:realConversation.id,occurred_at:"2026-08-22T15:00:17Z" },
    { ...msg("57e3b8ce-9646-44fd-9987-f7030e9a652f","inbound",0,"Primer inbound sanitizado"),conversation_id:realConversation.id,occurred_at:"2026-08-22T15:01:13Z" },
    { ...msg("59592da0-6e15-4aae-952c-8b5a2c619692","inbound",0,"Segundo inbound sanitizado"),conversation_id:realConversation.id,occurred_at:"2026-08-22T15:01:47Z" },
    { ...msg("future-human","outbound_human",0,"RESPUESTA HUMANA POSTERIOR"),conversation_id:realConversation.id,occurred_at:"2026-08-22T15:02:03.509Z" },
  ];
  const turns=buildRealShadowConversationTurns({messages:realMessages,conversations:[realConversation],env,now:Date.parse("2026-08-22T15:10:00Z")});
  const turn=turns[1];
  assert.deepEqual(turn.messageIds,["57e3b8ce-9646-44fd-9987-f7030e9a652f","59592da0-6e15-4aae-952c-8b5a2c619692"]);
  const snapshot=createShadowAiInputSnapshot(realShadowTurnEnvelope(turn,realConversation));
  assert.equal(snapshot.providerMetadata.priorConversation.reduce((sum,item)=>sum+item.sanitizedText.length,0),932);
  const run={input_kind:"conversational_message",round_state_json:{inputSnapshot:snapshot}};
  const reloadedAnchor={provider:"respond_admin",direction:"inbound",sanitized_text:"Sólo anchor",provider_metadata:{},occurred_at:"2026-08-22T15:01:47Z"};
  const finalEnvelope=inputEnvelopeForShadowAiRun(run,reloadedAnchor,null,realConversation);
  const modelInput=minimalShadowAiContext(finalEnvelope,{},[],0);
  assert.equal(modelInput.message,"Primer inbound sanitizado\nSegundo inbound sanitizado");
  assert.equal(modelInput.metadata.priorConversation.length,2);
  assert.equal(modelInput.metadata.priorConversation.reduce((sum,item)=>sum+item.sanitizedText.length,0),932);
  assert.doesNotMatch(JSON.stringify(modelInput),/RESPUESTA HUMANA POSTERIOR/);
});

test("continuation reutiliza snapshot inmutable y no incorpora outbound_human posterior", () => {
  const envelope={provider:"respond_admin",direction:"inbound",sanitizedText:"Sí, me apoyas con eso",occurredAt:"2026-08-22T15:01:47Z",externalMessageId:"turn:estable",providerMetadata:{channelId:"544519",priorConversation:[{direction:"outbound_human",sanitizedText:"¿Confirmas el asunto previo?"}],conversationTurn:{turnKey:"estable",messageIds:["a","b"],messageCount:2}}};
  const snapshot=createShadowAiInputSnapshot(envelope); const run={input_kind:"conversational_message",round_state_json:{inputSnapshot:snapshot}};
  const laterMessage={provider:"respond_admin",direction:"inbound",sanitized_text:"anchor",provider_metadata:{priorConversation:[{direction:"outbound_human",sanitizedText:"RESPUESTA NUEVA POSTERIOR"}]}};
  const round1=inputEnvelopeForShadowAiRun(run,laterMessage,null,conversation);
  const continuation=inputEnvelopeForShadowAiRun(run,laterMessage,null,conversation);
  assert.deepEqual(continuation,round1);
  assert.match(JSON.stringify(continuation),/asunto previo/);
  assert.doesNotMatch(JSON.stringify(continuation),/RESPUESTA NUEVA POSTERIOR/);
});

test("state machine usa el snapshot persistido como entrada real de todas las rondas", () => {
  const source=read("lib/shadow/ai/stateMachine.js");
  assert.match(source,/const inputEnvelope = inputEnvelopeForShadowAiRun\(run, message, operationalInput, messageConversation\)/);
  assert.match(source,/minimalShadowAiContext\(envelope, deterministic, previousTools, round - 1\)/);
  assert.match(source,/round_state_json: \{ resolvedOperationalContext, \.\.\.\(inputSnapshot \? \{ inputSnapshot \} : \{\}\), rounds: \[\] \}/);
  const prior=Array.from({length:10},(_,index)=>({direction:index%2?"outbound_human":"inbound",sanitizedText:"x".repeat(500)}));
  const snapshot=createShadowAiInputSnapshot({provider:"respond_admin",direction:"inbound",sanitizedText:"turn actual intacto",providerMetadata:{channelId:"544519",priorConversation:prior,conversationTurn:{turnKey:"t",messageIds:["a"],messageCount:1}}});
  assert.ok(snapshot.providerMetadata.priorConversation.length<=REAL_SHADOW_CONTEXT_MAX_MESSAGES);
  assert.ok(snapshot.providerMetadata.priorConversation.reduce((sum,item)=>sum+item.sanitizedText.length,0)<=REAL_SHADOW_CONTEXT_MAX_CHARS);
  assert.equal(snapshot.sanitizedText,"turn actual intacto");
  assert.doesNotMatch(JSON.stringify(snapshot),/raw_payload|phone|email|token/);
});

test("backfill ON y auto OFF permite backfill pero bloquea cron", () => {
  assert.equal(assertAutoRealEnvironment(prodBackfillEnv,{mode:"backfill"}).projectRef,"bnzrnizrmonjxlktbhlp");
  assert.throws(()=>assertAutoRealEnvironment(prodBackfillEnv,{mode:"auto"}),/auto_real_kill_switch_disabled/);
});

test("auto ON y backfill OFF permite cron pero bloquea backfill", () => {
  assert.equal(assertAutoRealEnvironment(prodAutoEnv).projectRef,"bnzrnizrmonjxlktbhlp");
  assert.throws(()=>assertAutoRealEnvironment(prodAutoEnv,{mode:"backfill"}),/auto_real_backfill_disabled/);
});

test("cutoff Auto-Real usa UTC, incluye igualdad y excluye histórico", () => {
  const turns=[
    {id:"before",lastInboundAt:"2026-08-22T14:59:59.999Z"},
    {id:"equal",lastInboundAt:"2026-08-22T15:00:00.000Z"},
    {id:"after",lastInboundAt:"2026-08-22T15:00:01.000Z"},
  ];
  const result=filterAutoRealTurnsByCutoff(turns,prodAutoEnv);
  assert.equal(result.cutoff.iso,"2026-08-22T15:00:00.000Z");
  assert.deepEqual(result.before.map(x=>x.id),["before"]);
  assert.deepEqual(result.eligible.map(x=>x.id),["equal","after"]);
});

test("cutoff ausente o inválido bloquea Auto-Real", () => {
  for (const value of [undefined,"","hoy","2026-08-22 15:00:00Z","2026-02-30T15:00:00Z","2026-08-22T15:00:00+00:00"]){
    const candidate={...prodAutoEnv,SHADOW_AI_AUTO_REAL_NOT_BEFORE:value};
    assert.throws(()=>parseAutoRealCutoff(candidate),/auto_real_cutoff_(?:required|invalid)/);
    assert.throws(()=>assertAutoRealEnvironment(candidate),/auto_real_cutoff_(?:required|invalid)/);
  }
});

test("Backfill conserva acceso histórico sin cutoff", () => {
  assert.equal(assertAutoRealEnvironment({...prodBackfillEnv,SHADOW_AI_AUTO_REAL_NOT_BEFORE:undefined},{mode:"backfill"}).mode,"production");
  const source=read("pages/api/operaciones/shadow-ai-real-backfill.js");
  assert.match(source,/loadAutoRealTurns\(admin, \{ lookbackDays, env: process\.env, inputMode: "backfill_real_shadow" \}\)/);
});

test("cutoff limita el disparador pero conserva contexto previo sanitizado", () => {
  const messages=[msg("old","inbound",0,"La cita es en Montpellier"),msg("human","outbound_human",1,"¿Confirmas que llegarás?"),msg("new","inbound",2,"Sí")];
  const turns=buildRealShadowConversationTurns({messages,conversations:[conversation],env,now:Date.parse("2026-08-21T12:10:00Z")});
  const result=filterAutoRealTurnsByCutoff(turns,{SHADOW_AI_AUTO_REAL_NOT_BEFORE:"2026-08-21T12:02:00Z"});
  assert.deepEqual(result.eligible.map(x=>x.anchorMessageId),["new"]);
  assert.deepEqual(result.eligible[0].priorContextMessages.map(x=>x.sanitizedText),["La cita es en Montpellier","¿Confirmas que llegarás?"]);
  assert.doesNotMatch(JSON.stringify(result.eligible[0]),/respuesta futura/);
});

test("ambos OFF bloquea ambas rutas y ambos ON falla cerrado para backfill", () => {
  const bothOff={...prodBaseEnv,SHADOW_AI_AUTO_REAL_ENABLED:"false",SHADOW_AI_BACKFILL_REAL_ENABLED:"false"};
  assert.throws(()=>assertAutoRealEnvironment(bothOff,{mode:"auto"}));
  assert.throws(()=>assertAutoRealEnvironment(bothOff,{mode:"backfill"}));
  const bothOn={...prodBaseEnv,SHADOW_AI_AUTO_REAL_ENABLED:"true",SHADOW_AI_BACKFILL_REAL_ENABLED:"true",SHADOW_AI_AUTO_REAL_NOT_BEFORE:"2026-08-22T15:00:00Z"};
  assert.equal(assertAutoRealEnvironment(bothOn,{mode:"auto"}).mode,"production");
  assert.throws(()=>assertAutoRealEnvironment(bothOn,{mode:"backfill"}),/auto_real_must_be_disabled_during_backfill/);
});

test("guardas comunes fail-closed para outbound, Operational Events, globals, entorno y Ventas", () => {
  for(const mode of ["auto","backfill"]){
    const source=mode==="auto"?prodAutoEnv:prodBackfillEnv;
    for(const override of [{SHADOW_AI_ENABLED:"false"},{SHADOW_AI_PRODUCTION_ENABLED:"false"},{SHADOW_AI_ALLOW_REAL_MESSAGES:"false"},{SHADOW_OUTBOUND_ENABLED:"true"},{SHADOW_AI_ALLOW_OPERATIONAL_EVENTS:"true"},{NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co"}]) assert.throws(()=>assertAutoRealEnvironment({...source,...override},{mode}));
  }
  assert.equal(buildRealShadowConversationTurns({ messages:[msg("a","inbound",0)], conversations:[{...conversation,channel:"498219"}], env, now:Date.parse("2026-08-21T12:10:00Z") }).length,0);
});

test("procesamiento limita concurrencia a un turn por invocation y no tiene retries automáticos", () => {
  assert.equal(AUTO_REAL_MAX_TURNS_PER_INVOCATION,1);
  const source=read("lib/shadow/ai/autoReal.js"); assert.match(source,/allowRetry: false/); assert.match(source,/if \(running\) return \{ status: "running"/); assert.doesNotMatch(source,/Promise\.all\([^)]*startAutoRealTurn|retryAuthorization/);
});

test("cron exige cutoff y expone observabilidad sanitizada", () => {
  const source=read("lib/shadow/ai/autoReal.js");
  assert.match(source,/turnsBeforeCutoffExcluded/);
  assert.match(source,/eligibleNewTurns/);
  assert.match(source,/lastAutomaticRun/);
  assert.doesNotMatch(source,/sanitizedText.*observability|priorContextMessages.*observability/);
});

test("auto endpoint no responde, escribe ERP ni procesa Operational Events", () => {
  const sources=[read("pages/api/cron/shadow-ai-real-auto.js"),read("pages/api/operaciones/shadow-ai-real-backfill.js"),read("lib/shadow/ai/autoReal.js")].join("\n");
  assert.doesNotMatch(sources,/sendMessage|respond\.io|maintenance_tickets.*(?:insert|update)|shadow_operational_events.*start/i);
  assert.match(sources,/SHADOW_AI_ALLOW_OPERATIONAL_EVENTS/); assert.match(sources,/SHADOW_OUTBOUND_ENABLED/);
});

test("UI productiva usa sesión normal, procesa una unidad y no expone credenciales", () => {
  const page=read("pages/coordinador-ia-sombra.js"); const endpoint=read("pages/api/operaciones/shadow-ai-real-backfill.js");
  assert.match(page,/Backfill Shadow real/); assert.match(page,/Procesar siguiente turn pendiente/); assert.match(page,/Continuar turn/);
  assert.match(page,/Authorization: `Bearer \$\{session\.access_token\}`/); assert.doesNotMatch(page,/localStorage|sessionStorage|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(endpoint,/authorizeShadowAdministrator/); assert.match(endpoint,/processNextAutoRealTurn/); assert.match(endpoint,/activeTurn/);
  assert.doesNotMatch(endpoint,/sendMessage|respond\.io|maintenance_tickets.*(?:insert|update)/i);
});

test("estimación de volumen entrega tokens y costo antes del backfill", () => {
  const estimate=estimateAutoRealVolume([{disposition:"pending"},{disposition:"skip_completed"}]); assert.equal(estimate.pendingTurns,1); assert.ok(estimate.inputTokens>0); assert.ok(estimate.estimatedCostUsd>0);
});
