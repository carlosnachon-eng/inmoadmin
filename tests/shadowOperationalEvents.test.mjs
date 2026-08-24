import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { operationalContextForPolicy, processOperationalOutbox, processOperationalOutboxEvent, validateMaintenanceScope, validateOperationalPayload } from "../lib/shadow/operationalEvents.js";
import { operationalWorkerGuard } from "../lib/shadow/operationalWorkerGuard.js";

const base = { eventType:"maintenance_ticket_created", ticketId:"f2a-op-ticket-1", maintenanceScope:"managed_property", propertyId:"f2a-op-property-1", priority:"media", payer:"propietario", status:"nuevo", occurredAt:"2026-08-21T12:00:00Z" };

test("managed_property exige propertyId",()=>{
  assert.equal(validateOperationalPayload(base).propertyId,"f2a-op-property-1");
  assert.throws(()=>validateOperationalPayload({...base,propertyId:null}),/requiere propertyId/);
});
test("external_job admite propertyId NULL con referencia estructurada",()=>{
  const value=validateOperationalPayload({...base,maintenanceScope:"external_job",propertyId:null,workReference:"FASE2A-OP-EVENT-QA-EXT-01"});
  assert.equal(value.propertyId,null); assert.equal(value.workReference,"FASE2A-OP-EVENT-QA-EXT-01");
});
test("NULL propertyId sin scope válido falla",()=>assert.throws(()=>validateMaintenanceScope({maintenanceScope:"",propertyId:null}),/inválido/));
test("quote approved requiere correlación y estados finales",()=>{
  const value=validateOperationalPayload({...base,eventType:"maintenance_quote_approved",quoteId:"f2a-op-quote-1",quoteStatus:"aprobada",ticketStatus:"aprobado",amount:3250,providerCost:2500});
  assert.equal(value.ticketId,base.ticketId); assert.equal(value.quoteId,"f2a-op-quote-1");
});
test("payload rechaza PII y URLs",()=>{
  assert.throws(()=>validateOperationalPayload({...base,maintenanceScope:"external_job",propertyId:null,workReference:"persona@example.com"}),/segura/);
});
test("external_job evita resolución de propiedad",()=>{
  const context=operationalContextForPolicy({...base,maintenanceScope:"external_job",propertyId:null,workReference:"FASE2A-OP-EVENT-QA-EXT-01"});
  assert.equal(context.skipPropertyResolution,true); assert.equal(context.kind,"operational_event");
});
test("fallo Shadow conserva evento pendiente y retry puede completarlo",async()=>{
  let calls=0; const query={select(){return this},is(){return this},lte(){return this},order(){return this},async limit(){return {data:[{event_id:"event-1"}],error:null}}};
  const db={from(){return query},async rpc(){calls+=1;return calls===1?{data:null,error:new Error("shadow down")}:{data:{status:"accepted"},error:null}}};
  assert.deepEqual(await processOperationalOutbox(db),[{eventId:"event-1",status:"pending_after_error"}]);
  assert.deepEqual(await processOperationalOutbox(db),[{eventId:"event-1",status:"accepted"}]);
});
test("worker limita lote y no contiene write tools/outbound/AI",async()=>{
  let requested=0; const query={select(){return this},is(){return this},lte(){return this},order(){return this},async limit(value){requested=value;return {data:[],error:null}}};
  await processOperationalOutbox({from(){return query},rpc(){throw new Error("unexpected")}}, {limit:99});
  assert.equal(requested,10);
});
test("Shadow conversacional ON no bloquea la ingesta operacional",()=>{
  assert.deepEqual(operationalWorkerGuard({SHADOW_AI_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"false"}),{allowed:true});
});
test("outbound continúa bloqueando el worker operacional",()=>{
  assert.deepEqual(operationalWorkerGuard({SHADOW_AI_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"true"}),{allowed:false,error:"Operational ingestion exige outbound apagado."});
});
test("el cron operacional no invoca Claude, Respond ni mutaciones ERP",()=>{
  const endpoint=fs.readFileSync(new URL("../pages/api/cron/shadow-operational-events.js",import.meta.url),"utf8");
  const worker=fs.readFileSync(new URL("../lib/shadow/operationalEvents.js",import.meta.url),"utf8");
  assert.doesNotMatch(endpoint,/anthropic|claude|respond|maintenance_(?:tickets|quotes)|admin\.from\(/i);
  assert.doesNotMatch(worker,/anthropic|claude|respond|maintenance_(?:tickets|quotes)/i);
  assert.match(worker,/admin\.rpc\("process_operational_event"/);
});
test("smoke manual procesa exclusivamente el eventId indicado",async()=>{
  const calls=[];
  const db={async rpc(name,args){calls.push({name,args});return {data:{status:"accepted"},error:null}}};
  assert.deepEqual(await processOperationalOutboxEvent(db,"f2000000-0000-4000-8000-000000000001"),[{eventId:"f2000000-0000-4000-8000-000000000001",status:"accepted"}]);
  assert.deepEqual(calls,[{name:"process_operational_event",args:{p_event_id:"f2000000-0000-4000-8000-000000000001"}}]);
  await assert.rejects(()=>processOperationalOutboxEvent(db,"not-an-event"),/eventId inválido/);
});
