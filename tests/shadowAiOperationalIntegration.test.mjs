import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { operationalEventToP3Input, finalizeOperationalP3Decision } from "../lib/shadow/ai/operationalEventAdapter.js";
import { deriveRequiredTools } from "../lib/shadow/ai/toolPolicy.js";
import { shadowAiGuard } from "../lib/shadow/ai/guards.js";

const id=(n)=>`f2${String(n).padStart(6,"0")}-0000-4000-8000-000000000001`;
const baseEvent={id:id(1),source:"inmoadmin",kind:"operational_event",event_type:"maintenance_ticket_created",payload_safe:{eventType:"maintenance_ticket_created",ticketId:id(2),maintenanceScope:"managed_property",propertyId:id(3),priority:"urgente",payer:"propietario",status:"nuevo",occurredAt:"2026-08-21T12:00:00Z"}};

test("Admin message and operational event remain distinct P3 input kinds",()=>{
  const input=operationalEventToP3Input(baseEvent);
  assert.equal(input.inputKind,"operational_event"); assert.equal(input.envelope.provider,"inmoadmin_operational");
  assert.equal(input.operationalContext.ticketId,id(2));
});
test("maintenance_ticket_created supplies structured policy context",()=>{
  const input=operationalEventToP3Input(baseEvent);
  const policy=deriveRequiredTools({intent:"mantenimiento",message:input.envelope.sanitizedText,resolvedOperationalContext:input.operationalContext});
  assert.deepEqual(policy.requiredNowTools.map(x=>x.name),["get_maintenance_ticket_summary"]);
  assert.deepEqual(policy.requiredNowTools[0].args,{ticketId:id(2)});
});
test("maintenance_quote_approved preserves quote, amount and provider cost",()=>{
  const event={...baseEvent,id:id(4),event_type:"maintenance_quote_approved",payload_safe:{...baseEvent.payload_safe,eventType:"maintenance_quote_approved",quoteId:id(5),quoteStatus:"aprobada",ticketStatus:"aprobado",amount:12500,providerCost:10000}};
  const input=operationalEventToP3Input(event);
  assert.equal(input.operationalContext.quoteId,id(5)); assert.equal(input.envelope.providerMetadata.amount,12500); assert.equal(input.envelope.providerMetadata.providerCost,10000);
});
test("external_job accepts propertyId NULL without property resolution",()=>{
  const input=operationalEventToP3Input({...baseEvent,payload_safe:{...baseEvent.payload_safe,maintenanceScope:"external_job",propertyId:null,workReference:"FASE2A-OP-QA-001"}});
  assert.equal(input.operationalContext.propertyId,null); assert.equal(input.operationalContext.skipPropertyResolution,true);
});
test("operational result has no customer response",()=>{
  const input=operationalEventToP3Input(baseEvent);
  const result=finalizeOperationalP3Decision({summary:"Ticket nuevo",proposedAction:"Revisar prioridad",proposedResponse:"texto",requiresHuman:true,urgency:"high",factualClaims:[]},input);
  assert.equal(result.proposedResponse,null); assert.equal(result.operationalOutput.interpretation,"Ticket nuevo"); assert.equal(result.operationalOutput.recommendedFollowUp,"Revisar prioridad");
});
test("operational AI guard is explicit, environment-bound and outbound fail-closed",()=>{
  const envelope=operationalEventToP3Input(baseEvent).envelope;
  const env={SHADOW_AI_ENABLED:"true",SHADOW_AI_ALLOW_OPERATIONAL_EVENTS:"true",SHADOW_AI_ALLOW_REAL_MESSAGES:"false",SHADOW_OUTBOUND_ENABLED:"false",SUPABASE_ENVIRONMENT:"dev",NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co",ANTHROPIC_API_KEY:"fixture"};
  assert.equal(shadowAiGuard(envelope,env).allowed,true);
  assert.equal(shadowAiGuard(envelope,{...env,SHADOW_OUTBOUND_ENABLED:"true"}).allowed,false);
  assert.equal(shadowAiGuard(envelope,{...env,NEXT_PUBLIC_SUPABASE_URL:"https://bnzrnizrmonjxlktbhlp.supabase.co"}).allowed,false);
});
test("real Admin messages require exact Production ref, dual opt-in and channel",()=>{
  const envelope={provider:"respond_admin",providerMetadata:{channelId:"544519"}};
  const env={SHADOW_AI_ENABLED:"true",SHADOW_AI_PRODUCTION_ENABLED:"true",SHADOW_AI_ALLOW_REAL_MESSAGES:"true",SHADOW_OUTBOUND_ENABLED:"false",SUPABASE_ENVIRONMENT:"production",NEXT_PUBLIC_SUPABASE_URL:"https://bnzrnizrmonjxlktbhlp.supabase.co",SHADOW_RESPOND_ADMIN_CHANNEL_ID:"544519",ANTHROPIC_API_KEY:"fixture"};
  assert.equal(shadowAiGuard(envelope,env).allowed,true);
  assert.equal(shadowAiGuard(envelope,{...env,SHADOW_RESPOND_ADMIN_CHANNEL_ID:"498219"}).allowed,false);
  assert.equal(shadowAiGuard(envelope,{...env,SHADOW_AI_PRODUCTION_ENABLED:"false"}).allowed,false);
});
test("state machine persists operational identity and never exposes write tools",()=>{
  const state=fs.readFileSync(new URL("../lib/shadow/ai/stateMachine.js",import.meta.url),"utf8");
  const context=fs.readFileSync(new URL("../lib/shadow/context.js",import.meta.url),"utf8");
  assert.match(state,/operational_event_id: input\.inputId/); assert.match(state,/operational:\$\{input\.inputId\}/); assert.match(state,/READ_ONLY_SHADOW_TOOLS/);
  assert.doesNotMatch(context,/create_maintenance|update_maintenance|send_message/);
});
test("production migration reconciles P3 once and preserves security",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608210003_fase_2a_p3_shadow_ai_integration.sql",import.meta.url),"utf8");
  assert.match(sql,/Colisión o instalación parcial P3/); assert.match(sql,/operational_event_id/); assert.match(sql,/enable row level security/); assert.match(sql,/revoke all .*anon/); assert.match(sql,/grant all .*service_role/);
  assert.doesNotMatch(sql,/insert into public\.(?:shadow_messages|shadow_operational_events|maintenance_tickets)/i);
});
test("operational APIs preserve auth and do not expose outbound",()=>{
  for(const path of ["../pages/api/operaciones/shadow-ai-operational-run.js","../pages/api/operaciones/shadow-ai-operational-continue.js"]){
    const source=fs.readFileSync(new URL(path,import.meta.url),"utf8"); assert.match(source,/admin|coord_operaciones/); assert.match(source,/SHADOW_OUTBOUND_ENABLED/); assert.doesNotMatch(source,/send|respond\.io|whatsapp/i);
  }
});
