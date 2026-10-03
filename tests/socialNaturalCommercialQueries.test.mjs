import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { classifySocialRoute, SOCIAL_CHANNELS } from "../lib/social/routing.js";
import { captureSocialRouteSafely } from "../lib/social/captureReceipt.js";
import { processSocialRouteImmediate } from "../lib/social/immediate.js";
import { SOCIAL_INVENTORY_CLARIFICATION } from "../lib/social/commercialIntent.js";
import * as agent from "../lib/agentsV2/openaiSalesAgent.js";
import * as usage from "../lib/agentsV2/agentUsage.js";
import * as handoffs from "../lib/agentsV2/salesHandoff.js";
import { processSalesAutoOutboundRun } from "../lib/agentsV2/salesAutoOutbound.js";
import { sanitizeShadowText } from "../lib/shadow/coordinator.js";
import { memoryDb, importWithStubs } from "./helpers/socialFixtures.mjs";

// User-supplied incident phrase, with synthetic identities only. No credentials,
// real models, provider calls, production fixtures or retrospective deliveries.
const exact = "Hola buenas tardes, tendra opciones de departamentos en zona centro, el carmen o cu?";
const queries = [exact, "Hola buenas tardes, tendrá opciones de departamentos en zona centro, El Carmen o CU?", "¿Tienen opciones de departamentos en Centro, El Carmen o CU?", "¿Manejan departamentos por Centro, El Carmen o CU?",
  "¿Tienen opciones de departamentos?", "¿Manejan departamentos?"];
const env = { SOCIAL_ROUTING_V1_ENABLED:"true", SALES_AGENT_V2_ENABLED:"true", SALES_AGENT_V2_PRODUCTION_SHADOW_ENABLED:"true",
  SALES_AGENT_V2_AUTO_SHADOW_ENABLED:"true", SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true", SALES_AGENT_V2_RECOVERY_ENABLED:"false",
  SALES_AGENT_V2_HANDOFF_SLA_ENABLED:"false", VERCEL_ENV:"production", SUPABASE_ENVIRONMENT:"production",
  OPENAI_API_KEY:"synthetic-only", OPENAI_SALES_AGENT_MODEL:"synthetic-only", RESPOND_IO_TOKEN:"synthetic-only" };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("real network forbidden");
after(() => { globalThis.fetch = originalFetch; });

async function harness(channelId, {assigned=false}={}) {
  const contact = "qa-natural-commercial-" + randomUUID(), sessions=[], sends=[], toolResults=[];
  const firstAt=Date.now()-120000;
  let sequence=0, plan=null;
  const db=memoryDb({
    social_capture_receipts:[], social_message_routes:[], sales_agent_v2_inbound_messages:[],
    gv_respond_contact_snapshots:[{respond_contact_id:contact, respond_record_active:true,
      metadata:{mapping_method:"current_assignee_unassigned"}, ...(assigned?{respond_assignee_id:"qa-existing-advisor"}:{} )}],
    propiedades:[{id:"qa-property",public_id:"EMP-QA-NATURAL",titulo:"Departamento QA Centro",colonia:"Centro",ciudad:"Puebla",
      status:"published",operacion:"rental",tipo:"Departamento",precio:9000,moneda:"MXN"}],
  },{
    // Persistence adapter only. Real JS capture, routing, continuity, processors,
    // tools, sender guards and handoff decisions below are NOT replaced.
    begin_social_capture_v1:async({p_event_id})=>{
      let row=db.tables.social_capture_receipts.find(r=>r.source_event_id===p_event_id);
      if(!row){row={source_event_id:p_event_id,routing_state:"pending",attempts:0};db.tables.social_capture_receipts.push(row);}
      row.attempts++;return {data:{state:row.routing_state}};
    },
    capture_social_route_v1:async({p_route})=>{
      const route={...p_route,id:randomUUID(),created_at:p_route.occurred_at};
      const inbound=route.destination==="SALES"?{id:randomUUID(),event_id:route.source_event_id,external_message_id:route.source_message_id,
        respond_contact_id:contact,channel_id:channelId,social_route_id:route.id,sanitized_text:route.sanitized_text,
        occurred_at:route.occurred_at,created_at:route.occurred_at,debounce_until:route.occurred_at,status:"captured"}:null;
      route.inbound_id=inbound?.id||null;
      db.tables.social_message_routes.push(route);
      if(inbound)db.tables.sales_agent_v2_inbound_messages.push(inbound);
      Object.assign(db.tables.social_capture_receipts.find(r=>r.source_event_id===route.source_event_id),{routing_state:"routed",route_id:route.id});
      return {data:{created:true,routeId:route.id,destination:route.destination,inboundId:route.inbound_id}};
    },
    fail_social_capture_v1:async()=>assert.fail("capture must not fail"),
  });
  const snapshotBefore=structuredClone(db.tables.gv_respond_contact_snapshots);
  const json=body=>new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
  globalThis.fetch=async(input,options={})=>{
    const u=new URL(String(input)), method=options.method||"GET";
    if(u.origin==="https://api.openai.com"){
      if(u.pathname==="/v1/agents/sessions"&&method==="POST"){
        assert.ok(plan);
        const request=JSON.parse(options.body);
        const s={id:`qa-session-${sessions.length}`,input:request.input,plan:structuredClone(plan),fulfilled:false};
        sessions.push(s);return json({id:s.id});
      }
      const match=u.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)(?:\/(items|events|turns))?$/);
      const s=sessions.find(s=>s.id===match?.[1]);assert.ok(s,"only synthetic session allowed");
      if(match[2]==="events"&&method==="POST"){
        const events=JSON.parse(options.body).events;assert.ok(events.every(e=>e.success===true));
        toolResults.push(...events.map(e=>JSON.parse(e.output)));s.fulfilled=true;return json({ok:true});
      }
      if(match[2]==="items")return json({data:[{role:"assistant",content:[{text:s.plan.output}]}]});
      if(match[2]==="turns")return json({data:[{usage:{input_tokens:10,output_tokens:10,total_tokens:20}}]});
      assert.equal(method,"GET");
      return json({id:s.id,status:s.plan.tools.length&&!s.fulfilled?"requires_action":"idle",
        required_actions:s.plan.tools.map((t,i)=>({type:"function_call",name:t.name,arguments:t.args,turn_id:"qa-turn",call_id:`qa-call-${i}`}))});
    }
    assert.equal(u.origin,"https://api.respond.io","no workflow, other provider or unexpected network");
    assert.equal(u.pathname,`/v2/contact/id:${contact}/message`);
    assert.equal(method,"POST");
    const body=JSON.parse(options.body);assert.equal(body.channelId,Number(channelId));assert.equal(body.message.type,"text");
    sends.push(body.message.text);return json({messageId:`qa-send-${sends.length}`});
  };
  const runner=await importWithStubs(new URL("../lib/agentsV2/runSalesShadowMessage.js",import.meta.url),{
    "./openaiSalesAgent":agent, "../shadow/coordinator":{sanitizeShadowText},
    "../ejecutivo/respondSync":{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:m=>m.at},
  });
  const processor=await importWithStubs(new URL("../lib/agentsV2/processSalesInbound.js",import.meta.url),{
    "./runSalesShadowMessage":runner,"./salesHandoff":handoffs,"./openaiSalesAgent":agent,"./agentUsage":usage,
    "./salesAutoOutbound":{processSalesAutoOutboundRun:async(db,id,options)=>{
      // Simulate PostgREST's FK join, not sender behavior.
      const run=db.tables.sales_agent_v2_shadow_runs.find(r=>r.id===id);
      run.sales_agent_v2_inbound_messages=db.tables.sales_agent_v2_inbound_messages.find(r=>r.id===run.inbound_message_id);
      return processSalesAutoOutboundRun(db,id,options);
    }},
  });
  const dispatch=route=>processSocialRouteImmediate(db,route,{
    SALES:processor.processSalesInboundById, OWNER:()=>assert.fail("cross-lane OWNER"), LEGAL:()=>assert.fail("cross-lane LEGAL"),
  },{env,sleep:async()=>{}});
  const step=async(text,output,tools=[],expectedOutput=output)=>{
    const n=sequence++,event={eventType:"message.received",eventId:`qa-event-${n}`,messageId:`qa-message-${n}`,
      respondContactId:contact,channelId,eventOccurredAt:new Date(firstAt+n*20000).toISOString()};
    const body={message:{text}};plan={output,tools};
    const route=await captureSocialRouteSafely(db,body,event,{env});
    assert.equal(route.destination,"SALES");
    assert.equal(db.tables.social_message_routes.at(-1).reason,"sales_intent");
    const result=await dispatch(route);
    assert.equal(result.status,"processed");assert.equal(result.outbound?.status,"sent");
    assert.equal(sends.at(-1),expectedOutput);
    assert.ok(sessions.at(-1).input.includes(text));
    const sentCount=sends.length;
    for(let retry=0;retry<3;retry++){
      const duplicate=await captureSocialRouteSafely(db,body,event,{env});
      assert.equal((await dispatch(duplicate)).status,"duplicate");
    }
    assert.equal((await processor.processSalesInboundById(db,route.inboundId,{env})).status,"not_claimed");
    assert.equal(sends.length,sentCount);
    assert.equal((db.tables.sales_agent_v2_handoffs||[]).length,0);
    assert.equal((db.tables.social_handoff_effects||[]).length,0);
    assert.equal((db.tables.citas||[]).length,0);
    assert.deepEqual(db.tables.gv_respond_contact_snapshots,snapshotBefore);
    return result;
  };
  return {db,sessions,sends,toolResults,step};
}

for(const [channelId,platform] of Object.entries(SOCIAL_CHANNELS))for(const [i,text] of queries.entries())
test(`${platform}: natural query ${i+1} -> capture -> processor -> useful sender -> retry`,async()=>{
  const h=await harness(channelId,{assigned:i%2===0});
  await h.step(text,"Hola, con gusto revisamos Centro, El Carmen o CU. ¿Buscas departamento en renta o en venta y cuál es tu presupuesto aproximado?");
  assert.equal(h.toolResults.length,0,"no invented listing or premature inventory filters");
  await h.step("en renta","¿Qué presupuesto mensual tienes para la renta en esas zonas?");
  assert.ok(h.sessions.at(-1).input.includes(text),"full original context survives follow-up");
  assert.ok(h.sessions.at(-1).input.includes("en renta"),"short operation answer reaches the real processor");
  assert.ok(!/renta o (?:en )?venta/i.test(h.sends.at(-1)),"do not ask the resolved operation again");
  await h.step("Mi presupuesto para renta es de 10000, en Centro de Puebla",
    "La publicación EMP-QA-NATURAL corresponde a un departamento en Centro con renta publicada de $9,000 MXN. La disponibilidad actual debe verificarse.",[
      {name:"check_sales_coverage",args:{location:"Puebla"}},
      {name:"search_sales_inventory",args:{operation:"rental",zone:"Centro",city:"Puebla",propertyType:"Departamento",maxPrice:10000}},
    ]);
  const inventory=h.toolResults.find(x=>Array.isArray(x?.listings));
  assert.equal(inventory.listings.length,1);assert.equal(inventory.listings[0].publicId,"EMP-QA-NATURAL");
  assert.equal(inventory.listings[0].price,9000);
  assert.equal(h.sends.length,3);assert.equal(new Set(h.sends).size,3);
  assert.equal(h.db.tables.social_message_routes.length,3);
  assert.equal(h.db.tables.sales_agent_v2_shadow_runs.length,3);
  assert.equal(h.db.tables.sales_agent_v2_auto_outbound.filter(r=>r.status==="sent").length,3);
});

for(const [channelId,platform] of Object.entries(SOCIAL_CHANNELS))
test(`${platform}: empty inventory retains existing guarded clarification, no fabricated availability`,async()=>{
  const h=await harness(channelId);
  h.db.tables.propiedades=[];
  await h.step(exact,"Hola, revisamos Centro, El Carmen o CU. ¿Buscas departamento en renta o en venta y cuál es tu presupuesto?");
  await h.step("Quiero departamentos en renta en Centro de Puebla, hasta 10000",
    "Con esos filtros no tengo una coincidencia verificada. ¿Puedes ampliar el presupuesto o considerar otra colonia?",[
      {name:"check_sales_coverage",args:{location:"Puebla"}},
      {name:"search_sales_inventory",args:{operation:"rental",zone:"Centro",city:"Puebla",propertyType:"Departamento",maxPrice:10000}},
    ],SOCIAL_INVENTORY_CLARIFICATION);
  // Existing inventory policy replaces every zero-match output. This patch
  // neither changes that policy nor claims this generic clarification is ideal.
  assert.deepEqual(h.toolResults.find(x=>Array.isArray(x?.listings)).listings,[]);
  assert.equal(h.sends.length,2);assert.equal(new Set(h.sends).size,2);
});

for(const channelId of Object.keys(SOCIAL_CHANNELS)){
  for(const noun of ["departamento","departamentos","casas","terrenos","inmuebles","propiedades"])
    test(`${channelId}: bounded property noun ${noun}`,()=>assert.deepEqual(classifySocialRoute({text:`¿Tienen opciones de ${noun} por el centro?`,channelId}),{destination:"SALES",reason:"sales_intent"}));
  for(const [text,destination,reason,context] of [
    ["Soy propietario, quiero vender mis departamentos","OWNER","owner_intent",{}],
    [exact,"OWNER","conversation_continuity",{previousDestination:"OWNER"}],
    [exact,"LEGAL","conversation_continuity",{previousDestination:"LEGAL"}],
    ["¿Qué incluye la póliza jurídica para departamentos?","LEGAL","legal_intent",{}],
    ["Necesito administración de departamentos","ADMINISTRATION","administration_intent",{}],
    ["Ofrezco videos con drones para mostrar departamentos","HUMAN_REVIEW","commercial_service_offer",{}],
    ["Tengo una queja por fraude con departamentos","HUMAN_REVIEW","sensitive_or_complaint",{}],
    ["Ya soy cliente y quiero información de departamentos","EXISTING_CLIENT","existing_client_review",{}],
    [exact,"HUMAN_REVIEW","identity_ambiguous",{identityStatus:"ambiguous"}],
  ])test(`${channelId}: priority ${reason}`,()=>assert.deepEqual(classifySocialRoute({text,channelId,...context}),{destination,reason}));
  for(const text of ["¿Tienen opciones de comida por el centro?","¿Manejan equipos para mi negocio?","¿Manejan repuestos para electrodomésticos?","Hola, quisiera conocer su organigrama departamental",
    "Tengo departamentos y quisiera información para promoverlos", "¿Tienen opciones para promover mis departamentos?", "Ofrezco departamentos y necesito información para publicarlos"]){
    // Unrelated request verbs or embedded substrings are not a SALES fallback.
    test(`${channelId}: unrelated request remains fallback-compatible: ${text}`,()=>assert.deepEqual(classifySocialRoute({text,channelId}),
      channelId==="498219"?{destination:"SALES",reason:"whatsapp_compatible_fallback"}:{destination:"UNKNOWN",reason:"classification_uncertain"}));
  }
}
