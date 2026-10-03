import test, { after } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, importWithStubs } from "./helpers/socialFixtures.mjs";
import * as handoffs from "../lib/agentsV2/salesHandoff.js";
import { processSalesAutoOutboundRun, classifySafeSalesOutbound } from "../lib/agentsV2/salesAutoOutbound.js";
import { readSalesConversation, salesClarificationPolicy, LINK_ALTERNATIVE } from "../lib/agentsV2/salesConversation.js";
import { publicPropertyReferences, resolvePublicPropertyReference } from "../lib/social/publicPropertyReference.js";
import { processSocialRouteImmediate } from "../lib/social/immediate.js";
import { SOCIAL_CTA_CLARIFICATION } from "../lib/social/commercialIntent.js";
import { sanitizeShadowText } from "../lib/shadow/coordinator.js";
import { salesAttentionDelivery } from "../lib/agentsV2/salesAttentionView.js";
import { executeSalesTool } from "../lib/agentsV2/openaiSalesAgent.js";
import { captureSocialRoute } from "../lib/social/routing.js";

const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;});
const env={SOCIAL_ROUTING_V1_ENABLED:"true",SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true",VERCEL_ENV:"production",SUPABASE_ENVIRONMENT:"production",RESPOND_IO_TOKEN:"synthetic-only"};
const start=Date.now()-120000;
const at=n=>new Date(start+n*1000).toISOString();
function fixture(messages){
  const inbound=messages.map((text,i)=>({id:`i${i}`,respond_contact_id:"synthetic-sales-recovery",channel_id:"497382",social_route_id:`r${i}`,occurred_at:at(i*10),created_at:at(i*10),sanitized_text:text,status:"captured"}));
  const db=memoryDb({sales_agent_v2_inbound_messages:inbound,gv_respond_contact_snapshots:[{respond_contact_id:inbound[0].respond_contact_id,respond_record_active:true,metadata:{mapping_method:"current_assignee_unassigned"}}],social_message_routes:inbound.map(row=>({id:row.social_route_id,inbound_id:row.id,respond_contact_id:row.respond_contact_id,source_channel_id:row.channel_id,destination:"SALES",occurred_at:row.occurred_at}))});
  return {db,inbound};
}
async function processor(db,{output="¿Qué zona prefieres?",tools=[],respondMessages=[],fulfill=async()=>true}={}){
  const inputs=[],sends=[],network=[];
  globalThis.fetch=async(url,options)=>{
    network.push({method:options?.method,url});
    assert.equal(url,`https://api.respond.io/v2/contact/id:synthetic-sales-recovery/message`);
    assert.equal(options.method,"POST");
    sends.push(JSON.parse(options.body).message.text);
    return{ok:true,json:async()=>({messageId:`synthetic-send-${sends.length}`})};
  };
  let poll=0;
  const runner=await importWithStubs(new URL("../lib/agentsV2/runSalesShadowMessage.js",import.meta.url),{
    "./openaiSalesAgent":{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:async({input})=>{inputs.push(input);poll=0;return{id:"synthetic-session"};},getSalesSession:async()=>({id:"synthetic-session",status:tools.length&&poll++===0?"requires_action":"idle",required_actions:tools.map(name=>({name}))}),fulfillSalesActions:fulfill,salesSessionItems:async()=>[],salesAssistantOutput:()=>output},
    "../ejecutivo/respondSync":{readRespondMessages:async()=>({messages:respondMessages}),respondMessageTimestamp:row=>row.at},
    "../shadow/coordinator":{sanitizeShadowText},
  });
  const real=await importWithStubs(new URL("../lib/agentsV2/processSalesInbound.js",import.meta.url),{
    "./runSalesShadowMessage":runner,"./salesHandoff":handoffs,
    "./salesAutoOutbound":{processSalesAutoOutboundRun:async(db,id,options)=>{
      const run=db.tables.sales_agent_v2_shadow_runs.find(row=>row.id===id);
      run.sales_agent_v2_inbound_messages=db.tables.sales_agent_v2_inbound_messages.find(row=>row.id===run.inbound_message_id);
      return processSalesAutoOutboundRun(db,id,options);
    }},
    "./agentUsage":{safeAgentUsage:async()=>({inputTokens:null,outputTokens:null,totalTokens:null,estimatedCostUsd:null})},
    "./openaiSalesAgent":{salesAgentModel:()=>"synthetic"},
  });
  return{run:id=>real.processSalesInboundById(db,id,{env}),inputs,sends,network};
}

for(const [name,messages,answer] of [
  ["rent follow-up",["Busco departamento amueblado con estacionamiento","Renta"],"¿Qué zona prefieres para el departamento en renta?"],
  ["location follow-up",["Busco departamentos en renta","En Puebla"],"¿Qué presupuesto tienes para la renta en Puebla?"],
  ["building follow-up",["Busco departamento amueblado","Renta","[URL]","Este","Torre Edificio Sintético"],"¿Cuál es tu presupuesto para el departamento?"],
])test(`full conversation ${name}: context precedes CTA; actual sender once`,async()=>{
  const {db,inbound}=fixture(messages);
  for(const row of db.tables.sales_agent_v2_inbound_messages.slice(0,-1))row.status="processed";
  const p=await processor(db,{output:answer,respondMessages:[{at:at(1),traffic:"outgoing",text:"¿Buscas renta o compra?"}]});
  const result=await p.run(inbound.at(-1).id);
  assert.equal(result.outbound.status,"sent");assert.deepEqual(p.sends,[answer]);
  for(const text of messages)assert.ok(p.inputs[0].includes(text));
  assert.ok(p.inputs[0].includes("¿Buscas renta o compra?"));
  assert.equal((await p.run(inbound.at(-1).id)).status,"not_claimed");
  assert.equal(p.sends.length,1);assert.equal(db.tables.sales_agent_v2_handoffs.length,0);
});

test("Chapulco: real inventory tool + coordination output reaches sender, no fictitious booking",async()=>{
  const {db,inbound}=fixture(["Buen día, disponible para visita la casa de 3 recámaras en Chapulco?"]);
  db.tables.propiedades=[{id:"synthetic-listing",public_id:"EMP-MUN7BHJX",titulo:"Casa en Venta en Chapulco, Puebla | 3 Recámaras y Vista a la Laguna",status:"published",operacion:"sale",precio:1800000,moneda:"MXN",recamaras:3,colonia:"Chapulco"}];
  let evidence;
  const output="La publicación EMP-MUN7BHJX indica $1,800,000 MXN. Podemos solicitar una visita con un asesor.";
  const p=await processor(db,{output,tools:["search_sales_inventory"],fulfill:async({socialContext})=>{
    evidence=await executeSalesTool(db,"search_sales_inventory",{zone:"Chapulco"},{socialContext});return true;
  }});
  const result=await p.run(inbound[0].id);
  assert.equal(evidence.listings[0].publicId,"EMP-MUN7BHJX");assert.equal(evidence.listings[0].price,1800000);
  assert.equal(result.outbound.status,"sent");assert.deepEqual(p.sends,[output]);
  assert.equal(db.tables.citas?.length||0,0);
});

test("webhook parses first-party property before sanitization without persisting its URL",async()=>{
  let route;
  const db=memoryDb({propiedades:[{id:"synthetic-property",public_id:"EMP-SYNTHETIC1",status:"published"}]},{capture_social_route_v1:async({p_route})=>{route=p_route;return{data:{created:true,destination:"SALES"}};}});
  const url="https://www.emporioinmobiliario.com.mx/propiedades/EMP-SYNTHETIC1?private_tracking=remove";
  await captureSocialRoute(db,{message:{text:`Me interesa ${url}`}},{eventType:"message.received",eventId:"synthetic-event",messageId:"synthetic-message",respondContactId:"synthetic-contact",channelId:"497382",eventOccurredAt:at(0)},{env});
  assert.equal(route.source_property_id,"synthetic-property");assert.match(route.sanitized_text,/\[URL\]/);
  assert.doesNotMatch(JSON.stringify(route),/https|private_tracking|remove/);
});

test("operations GET exposes actionable review and delivery evidence only to active admin/manager",async()=>{
  for(const role of ["admin","gerente_ventas","asesor"]){
    const db=memoryDb({profiles:[{id:"synthetic-admin",active:true,role_id:role}],sales_agent_v2_handoffs:[{id:"review",respond_contact_id:"synthetic-contact",status:"ready_for_advisor",assignment_error_code:"workflow_not_configured",summary:"Solicitud sintética",created_at:at(0)}]});
    const handler=(await importWithStubs(new URL("../pages/api/operaciones/sales-v2-shadow-view.js",import.meta.url),{
      "@supabase/supabase-js":{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:"synthetic-admin"}}})},from:db.from})},
      "../../../lib/ejecutivo/workCenter":{getAdminSupabase:()=>db,respondInboxLink:()=>"https://app.respond.io/space/synthetic/inbox/synthetic"},
    })).default;
    const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:"GET",headers:{authorization:"Bearer synthetic"}},response);
    if(role==="asesor"){assert.equal(response.code,403);continue;}
    assert.equal(response.code,200);assert.equal(response.body.reviews[0].operationalOwner,"Gerencia de Ventas");
    assert.equal(response.body.reviews[0].assignment_error_code,"workflow_not_configured");
    assert.match(response.body.reviews[0].inboxUrl,/^https:\/\/app.respond.io\//);
    assert.ok(db.operations.every(op=>op.op==="select"));
  }
});

for(const request of ["Me gustaría visitar la casa en Momoxpan","Quiero hablar con una persona"])
test(`burst ${request} + Plis retains intent, no fragment dispatch`,async()=>{
  const {db,inbound}=fixture([request,"Plis"]);
  db.tables.sales_agent_v2_inbound_messages[1].occurred_at=at(1.786);
  const p=await processor(db,{output:"Podemos solicitar una visita; requiere confirmación del asesor."});
  const absorbed=await processSocialRouteImmediate(db,{created:true,inboundId:inbound[0].id,destination:"SALES"},{SALES:()=>assert.fail("older fragment must not run")},{env:{...env,SALES_AGENT_V2_AUTO_SHADOW_ENABLED:"true"},sleep:async()=>{}});
  assert.equal(absorbed.status,"absorbed_by_newer_message");
  const result=await p.run(inbound[1].id);
  assert.equal(result.handoff.created,true);
  assert.equal(result.handoff.reason,request.startsWith("Quiero")?"human_requested":"appointment_intent");
  assert.equal(result.handoff.dispatch.reason,"workflow_not_configured");
  assert.equal(db.tables.sales_agent_v2_handoffs[0].assignment_error_code,"workflow_not_configured");
  assert.equal(db.tables.sales_agent_v2_handoffs.length,1);
  assert.equal(p.sends.length,0);assert.equal(p.network.length,0);
  if(request.startsWith("Quiero"))assert.equal(p.inputs.length,0,"human request needs no model");
  else assert.ok(p.inputs[0].includes(request));
});

test("unresolved link: alternative once, second repetition creates visible review, not another link request",async()=>{
  const {db,inbound}=fixture(["Busco una casa en renta","[URL]","Es esta [URL]"]);
  db.tables.sales_agent_v2_inbound_messages[0].status="processed";
  // Previously sent clarification is evidence, not an unsent proposal.
  db.tables.sales_agent_v2_auto_outbound=[{inbound_message_id:"i0",respond_contact_id:inbound[0].respond_contact_id,channel_id:"497382",status:"sent",proposed_message:SOCIAL_CTA_CLARIFICATION,sent_at:at(1)}];
  db.tables.sales_agent_v2_inbound_messages.pop();
  const p=await processor(db,{output:SOCIAL_CTA_CLARIFICATION});
  assert.equal((await p.run("i1")).outbound.status,"sent");
  assert.deepEqual(p.sends,[LINK_ALTERNATIVE]);
  db.tables.sales_agent_v2_auto_outbound.at(-1).sent_at=at(11);
  db.tables.sales_agent_v2_inbound_messages.push(inbound[2]);
  const reviewed=await p.run("i2");
  assert.equal(reviewed.handoff.created,true);
  assert.equal(db.tables.sales_agent_v2_handoffs[0].reason,"automation_fallback");
  assert.equal(p.sends.length,1);assert.equal(p.inputs.length,2);
  assert.equal(reviewed.handoff.dispatch.assignmentTriggered,false);
});

test("only same-channel context, no later messages or proposals masquerading as sent",async()=>{
  const {db,inbound}=fixture(["El conde"]);
  db.tables.sales_agent_v2_inbound_messages.push({...inbound[0],id:"other",channel_id:"498219",sanitized_text:"Quiero un humano"});
  const context=await readSalesConversation(db,inbound[0]);
  assert.equal(context.hasContext,false);assert.equal(context.burstText,"El conde");
  assert.equal(context.clarificationSent,false);
});

test("short building reply with persisted profile context is not an isolated CTA in runner or sender",async()=>{
  const {db,inbound}=fixture(["Torre Edificio Sintético"]);
  db.tables.gv_respond_contact_snapshots[0].inm_zona="Zona sintética";
  const p=await processor(db,{output:"¿Qué presupuesto tienes para la renta?"});
  assert.equal((await p.run(inbound[0].id)).outbound.status,"sent");
  assert.equal(p.inputs.length,1);assert.equal(p.sends.length,1);
});

test("expired historical proposal is never resent or backfilled by this patch",async()=>{
  const {db,inbound}=fixture(["Información de la casa"]);
  db.tables.sales_agent_v2_shadow_runs=[{id:"historical",status:"idle",completed_at:new Date(Date.now()-86400000).toISOString(),proposed_response:"¿En qué zona buscas?",sales_agent_v2_inbound_messages:inbound[0]}];
  globalThis.fetch=async()=>assert.fail("no historical traffic");
  const result=await processSalesAutoOutboundRun(db,"historical",{env});
  assert.equal(result.reason,"stale_run");
  assert.ok(db.operations.every(row=>row.op==="select"));
});

test("a durable blocked outcome claimed by another sender still becomes actionable review",async()=>{
  const {db,inbound}=fixture(["Información de la casa"]);
  db.tables.sales_agent_v2_auto_outbound=[{inbound_message_id:inbound[0].id,status:"blocked",error_code:"risky_topic"}];
  const p=await processor(db,{output:"Firma el contrato."});
  const result=await p.run(inbound[0].id);
  assert.equal(result.outbound.status,"already_handled");assert.equal(result.outbound.outboundStatus,"blocked");
  assert.equal(result.handoff.created,true);assert.equal(p.network.length,0);
  assert.equal(db.tables.sales_agent_v2_handoffs[0].assignment_error_code,"sender_requires_review");
});

test("review queue paginates so older jobs cannot hide fresh human requests",async()=>{
  const db=memoryDb({profiles:[{id:"operator",active:true,role_id:"gerente_ventas"}],sales_agent_v2_handoffs:Array.from({length:101},(_,i)=>({id:`review-${i}`,respond_contact_id:"synthetic",status:"ready_for_advisor",created_at:at(i)}))});
  const handler=(await importWithStubs(new URL("../pages/api/operaciones/sales-v2-shadow-view.js",import.meta.url),{
    "@supabase/supabase-js":{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:"operator"}}})},from:db.from})},
    "../../../lib/ejecutivo/workCenter":{getAdminSupabase:()=>db,respondInboxLink:()=>null},
  })).default;
  const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  const first=response(),second=response();
  await handler({method:"GET",headers:{authorization:"Bearer synthetic"}},first);
  await handler({method:"GET",headers:{authorization:"Bearer synthetic"},query:{reviewOffset:"100"}},second);
  assert.equal(first.body.reviews.length,100);assert.equal(first.body.reviews[0].id,"review-100");
  assert.equal(first.body.reviewsHasMore,true);assert.equal(second.body.reviews.length,1);
  assert.equal(second.body.reviews[0].id,"review-0");assert.equal(second.body.reviewsHasMore,false);
});

for(const output of ["Te confirmo cuál es.","Te confirmo la información publicada.","Te confirmo disponibilidad.","Podemos coordinar una visita con un asesor.","La visita no está confirmada."])
test(`informational/coordinating is sendable: ${output}`,async()=>{
  const {db,inbound}=fixture(["Información sobre la casa en Momoxpan"]);
  const p=await processor(db,{output,tools:["search_sales_inventory"]});
  assert.equal((await p.run(inbound[0].id)).outbound.status,"sent");assert.deepEqual(p.sends,[output]);
});
for(const output of ["Nos vemos mañana a las 10:30.","La visita está confirmada.","Firma el contrato.","Te confirmo el horario.","Queda agendada."])
test(`unsafe remains blocked and reason durable: ${output}`,async()=>{
  const {db,inbound}=fixture(["Información de la casa"]),p=await processor(db,{output,tools:["search_sales_inventory"]});
  assert.equal((await p.run(inbound[0].id)).outbound.status,"blocked");
  assert.equal(db.tables.sales_agent_v2_auto_outbound[0].status,"blocked");
  assert.ok(db.tables.sales_agent_v2_auto_outbound[0].error_code);assert.equal(p.sends.length,0);
  assert.equal(db.tables.sales_agent_v2_handoffs.length,1);
  assert.equal(db.tables.sales_agent_v2_handoffs[0].assignment_error_code,"sender_requires_review");
});

test("diagnostic projection allowlists reasons and never echoes raw transport errors",()=>{
  assert.equal(salesAttentionDelivery(null),null);
  assert.deepEqual(salesAttentionDelivery({status:"blocked",error_code:"secret https://private.invalid/token",raw:"hidden"}),{status:"blocked",error_code:"requires_manual_review",sent_at:null});
  assert.equal(salesAttentionDelivery({status:"blocked",error_code:"risky_topic"}).error_code,"risky_topic");
});

test("manual assignment after first live read prevents workflow and ACK; uncertainty never retries",async()=>{
  const {db,inbound}=fixture(["Quiero hablar con una persona"]);
  let reserved=false,reads=0,writes=0;
  db.rpc=async(name)=>{
    if(name==="reserve_social_effect_v1"){
      if(reserved)return{data:{owned:false,status:"uncertain"}};
      reserved=true;return{data:{owned:true,token:"synthetic-reservation"}};
    }
    assert.equal(name,"finish_social_effect_v1");return{};
  };
  const h=await handoffs.createSalesHandoffIfNeeded(db,{inbound:inbound[0],env});
  globalThis.fetch=async(_url,options)=>{
    if(options.method!=="GET"){writes++;assert.fail("no remote mutation allowed");}
    reads++;return{ok:true,json:async()=>({id:inbound[0].respond_contact_id,assignee:reads===1?null:{id:"synthetic-human"}})};
  };
  const opts={handoffId:h.handoffId,env:{...env,SALES_AGENT_V2_HANDOFF_WORKFLOW_URL:"https://hooks.respond.io/synthetic"}};
  await assert.rejects(handoffs.dispatchSalesHandoff(db,opts),/uncertain_manual_review/);
  assert.equal((await handoffs.dispatchSalesHandoff(db,opts)).reason,"existing_responsible_preserved");
  assert.equal(writes,0);assert.equal(reserved,true);
});

test("allowlisted public reference uses published catalog; strips tracking, no fetch",async()=>{
  globalThis.fetch=async()=>assert.fail("URL resolution must not fetch");
  const db=memoryDb({propiedades:[{id:"property",public_id:"EMP-SYNTHETIC1",status:"published"}]});
  const result=await resolvePublicPropertyReference(db,"https://www.emporioinmobiliario.com.mx/propiedades/EMP-SYNTHETIC1?token=never-persist",null);
  assert.equal(result.propertyId,"property");assert.doesNotMatch(JSON.stringify(result),/token|https/);
  for(const url of ["http://www.emporioinmobiliario.com.mx/propiedades/EMP-SYNTHETIC1","https://evil.invalid/propiedades/EMP-SYNTHETIC1","https://user:pass@www.emporioinmobiliario.com.mx/propiedades/EMP-SYNTHETIC1","https://www.emporioinmobiliario.com.mx.evil.invalid/propiedades/EMP-SYNTHETIC1","https://127.0.0.1/propiedades/EMP-SYNTHETIC1","https://www.emporioinmobiliario.com.mx/redirect?url=EMP-SYNTHETIC1"])
    assert.deepEqual(publicPropertyReferences(url).publicIds,[]);
  db.tables.propiedades[0].status="draft";
  assert.equal((await resolvePublicPropertyReference(db,"https://emporioinmobiliario.com.mx/propiedades/EMP-SYNTHETIC1",null)).propertyId,null);
});

test("existing responsible and unverifiable live assignment never call workflow/ACK",async()=>{
  for(const assigned of [true,false]){
    const {db,inbound}=fixture(["Quiero hablar con una persona"]);
    if(assigned)db.tables.gv_respond_contact_snapshots[0].respond_assignee_id="synthetic-advisor";
    const h=await handoffs.createSalesHandoffIfNeeded(db,{inbound:inbound[0],env});
    assert.equal(h.created,true,"review still exists for an already assigned person");
    let reads=0;
    globalThis.fetch=async(_url,opts)=>{reads++;assert.equal(opts.method,"GET");return{ok:true,json:async()=>({id:inbound[0].respond_contact_id})};};
    const result=await handoffs.dispatchSalesHandoff(db,{handoffId:h.handoffId,env:{...env,SALES_AGENT_V2_HANDOFF_WORKFLOW_URL:"https://hooks.respond.io/synthetic"}});
    assert.equal(result.assignmentTriggered,false);
    assert.equal(result.reason,assigned?"existing_responsible_preserved":"assignment_live_state_unverified");
    assert.equal(reads,assigned?0:1);
  }
});
