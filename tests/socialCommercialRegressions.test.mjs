import test, { after } from "node:test";
import assert from "node:assert/strict";
import { captureSocialRoute, classifySocialRoute, socialRouteReview } from "../lib/social/routing.js";
import { classifySalesHandoff, createSalesHandoffIfNeeded, createSalesAutomationFallbackHandoff, dispatchSalesHandoff, processSalesHandoffSla } from "../lib/agentsV2/salesHandoff.js";
import { classifySafeSalesOutbound, processSalesAutoOutboundRun } from "../lib/agentsV2/salesAutoOutbound.js";
import { executeSalesTool, fulfillSalesActions } from "../lib/agentsV2/openaiSalesAgent.js";
import { readSocialSalesContext, socialSalesOutput, inventoryTerms } from "../lib/social/salesInventory.js";
import { isCommercialServiceOffer, explicitPropertyAppointment, SOCIAL_CTA_CLARIFICATION, SOCIAL_INVENTORY_CLARIFICATION } from "../lib/social/commercialIntent.js";
import { memoryDb, importWithStubs } from "./helpers/socialFixtures.mjs";

// All contact IDs, messages except the public query, and state are synthetic.
// Public listing data is a copy of user-supplied evidence, NOT a freshness check.
const listing={id:"synthetic-property",public_id:"EMP-MUN7BHJX",titulo:"Casa en Venta en Chapulco, Puebla | 3 Recámaras y Vista a la Laguna",status:"published",operacion:"sale",tipo:"Casa",precio:1800000,moneda:"MXN",recamaras:3,colonia:"Chapulco",ciudad:"Puebla",direccion:"Ubicación sintética",updated_at:"2026-10-01"};
const query="Hola me puedes dar inf de una casa que indicas está atrás de la laguna de chapulco";
const env={SOCIAL_ROUTING_V1_ENABLED:"true",SALES_AGENT_V2_HANDOFF_WORKFLOW_URL:"https://hooks.respond.io/synthetic",RESPOND_IO_TOKEN:"synthetic",SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:"true",VERCEL_ENV:"production",SUPABASE_ENVIRONMENT:"production"};
const contact="synthetic-social-prospect", at="2026-10-01T14:00:00.000Z";
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>assert.fail("real network forbidden");
after(()=>{globalThis.fetch=originalFetch;});
function fixture(text,{sourcePropertyId=null}={}){
  const inbound={id:"inbound",social_route_id:"route",respond_contact_id:contact,channel_id:"497382",occurred_at:at,sanitized_text:text,status:"captured"};
  const db=memoryDb({
    sales_agent_v2_inbound_messages:[inbound],propiedades:[listing],
    gv_respond_contact_snapshots:[{respond_contact_id:contact,respond_record_active:true,metadata:{mapping_method:"current_assignee_unassigned"}}],
    social_message_routes:[{id:"route",inbound_id:"inbound",destination:"SALES",source_channel_id:"497382",respond_contact_id:contact,occurred_at:at,source_property_id:sourcePropertyId}],
  });
  return {db,inbound};
}

for(const verb of ["mostrar","enseñar","verlo","verla","hoy","mañana"])
  test(`verbo/tiempo aislado no es appointment: ${verb}`,()=>{
    assert.equal(classifySalesHandoff(verb,{strict:true}),null);
    assert.equal(explicitPropertyAppointment(verb),false);
  });
for(const text of ["Ofrezco servicios audiovisuales con drones para mostrar mejor los espacios", "Ofrecemos videos para mostrar propiedades", "Soy fotógrafo y ofrezco videos para enseñar casas", "Brindamos recorridos virtuales para mostrar mejor los espacios"])
  test(`proveedor no es prospecto: ${text}`,async()=>{
    assert.equal(isCommercialServiceOffer(text),true);
    assert.deepEqual(classifySocialRoute({text,channelId:"497382"}),{destination:"HUMAN_REVIEW",reason:"commercial_service_offer"});
    assert.equal(classifySalesHandoff(text,{strict:true}),null);
    const {db,inbound}=fixture(text);
    assert.equal((await createSalesHandoffIfNeeded(db,{inbound,env})).created,false);
    assert.equal((await createSalesAutomationFallbackHandoff(db,{inbound,env})).created,false);
    assert.equal((db.tables.sales_agent_v2_handoffs||[]).length,0);
    assert.ok(db.operations.every(o=>o.op==="select"));
    assert.equal(classifySafeSalesOutbound({messageText:text,calledTools:[],proposedResponse:"Te asigno asesor",socialContext:{}}).eligible,false);
  });
for(const text of ["Quiero visitar la casa", "¿Podrías mostrarme el departamento?", "Quisiera agendar una visita al terreno"])
  test(`solicitud inequívoca mantiene handoff: ${text}`,()=>{
    assert.equal(classifySalesHandoff(text,{strict:true}).reason,"appointment_intent");
    assert.equal(isCommercialServiceOffer(text),false);
  });
test("pronombre sólo permite visita con propiedad de origen verificada",()=>{
  assert.equal(classifySalesHandoff("Quiero verlo",{strict:true}),null);
  assert.equal(classifySalesHandoff("Quiero verlo",{strict:true,verifiedProperty:true}).reason,"appointment_intent");
  assert.equal(classifySalesHandoff("¿Quieres mostrar tu casa con un video?",{strict:true}),null);
});
test("CTA corto: decisión auditada de aclaración, sin presumir propiedad ni interés alto",()=>{
  const route=classifySocialRoute({text:"El conde",channelId:"497382"});
  assert.deepEqual(route,{destination:"SALES",reason:"cta_clarification_required"});
  assert.equal(socialRouteReview(route).reason,"cta_clarification_required");
  assert.equal(classifySalesHandoff("El conde",{strict:true}),null);
  assert.equal(classifySalesHandoff("El conde",{strict:true,verifiedProperty:true}),null);
});
test("CTA usa atribución validada, no post/campaign o keyword como mapping inventado",async()=>{
  for(const source of [{post_id:"post",campaign_id:"campaign"},{property_id:listing.public_id},{property_id:"missing-public-id"}]){
    let saved;
    const db=memoryDb({propiedades:[listing]},{capture_social_route_v1:async({p_route})=>{saved=p_route;return {data:{destination:p_route.destination}};}});
    await captureSocialRoute(db,{message:{text:"El conde"},source},{eventType:"message.received",eventId:"event",messageId:"message",respondContactId:contact,channelId:"497382",eventOccurredAt:at},{env});
    const valid=source.property_id===listing.public_id;
    assert.equal(saved.reason,valid?"verified_property_context":"cta_clarification_required");
    assert.equal(saved.source_property_id,valid?listing.id:null);
  }
});
test("origen inexistente/no publicado/cruzado no se usa; queries sólo lectura",async()=>{
  const {db,inbound}=fixture("El conde",{sourcePropertyId:listing.id});
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty.publicId,listing.public_id);
  db.tables.social_message_routes[0].respond_contact_id="other-contact";
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty,null);
  db.tables.social_message_routes[0].respond_contact_id=contact;
  db.tables.propiedades[0].status="draft";
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty,null);
  assert.ok(db.operations.every(o=>o.op==="select"));
});
test("CTA reutiliza origen explícito del inmediato antecedente SALES, sin inventar atribución",async()=>{
  const {db,inbound}=fixture("El conde");
  db.tables.social_message_routes.push({id:"previous",occurred_at:"2026-10-01T13:00:00.000Z",respond_contact_id:contact,source_channel_id:"497382",destination:"SALES",source_property_id:listing.id});
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty.publicId,listing.public_id);
  assert.equal(db.tables.social_message_routes[0].source_property_id,null);
  db.tables.social_message_routes[1].source_channel_id="498219";
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty,null);
  db.tables.social_message_routes[1].source_channel_id="497382";
  db.tables.social_message_routes[1].destination="OWNER";
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty,null);
  db.tables.social_message_routes[1].destination="SALES";
  db.tables.social_message_routes[1].occurred_at=at;
  assert.equal((await readSocialSalesContext(db,inbound,env)).sourceProperty,null);
});
for(const text of ["El conde","Ofrezco videos con drones para mostrar propiedades"])
  for(const reason of ["automation_fallback","appointment_intent"])
    test(`handoff histórico inseguro no dispara workflow, ACK ni SLA: ${reason}/${text}`,async()=>{
      const {db}=fixture(text);
      db.tables.sales_agent_v2_handoffs=[{id:"handoff",social_route_id:"route",inbound_message_id:"inbound",respond_contact_id:contact,channel_id:"497382",reason,status:"assignment_requested",assignment_requested_at:at,sla_due_at:"2026-01-01",reassignment_count:2}];
      const before=JSON.stringify(db.tables.sales_agent_v2_handoffs);
      assert.equal((await dispatchSalesHandoff(db,{handoffId:"handoff",env})).assignmentTriggered,false);
      assert.equal((await processSalesHandoffSla(db,{env})).status,"idle");
      assert.equal(JSON.stringify(db.tables.sales_agent_v2_handoffs),before);
      assert.ok(db.operations.every(o=>o.op==="select"));
    });
test("fallback con intención real usa razón real; nunca acuña interés alto por error de automatización",async()=>{
  const {db,inbound}=fixture("Quiero visitar la casa");
  const created=await createSalesAutomationFallbackHandoff(db,{inbound,env});
  assert.equal(created.reason,"appointment_intent");
  assert.doesNotMatch(db.tables.sales_agent_v2_handoffs[0].summary,/automation fallback/);
});

test("reproducción: búsqueda anterior de frase completa omite Chapulco; nueva encuentra publicación",async()=>{
  const db=memoryDb({propiedades:[listing]});
  const args={zone:"atrás de la laguna de Chapulco",operation:"sale",propertyType:"Casa"};
  assert.deepEqual(await executeSalesTool(db,"search_sales_inventory",args),[],"legacy false negative reproduced");
  const result=await executeSalesTool(db,"search_sales_inventory",args,{socialContext:{messageText:query}});
  assert.equal(result.listings.length,1);assert.equal(result.listings[0].publicId,listing.public_id);
  assert.equal(result.listings[0].price,1800000);assert.equal(result.sourceConfirmed,false);
  assert.equal(result.searchEvidence.evidence,"published_text_matches_not_source_confirmation");
  assert.ok(db.operations.every(o=>o.op==="select"));
});
test("cobertura también deja de exigir frase literal, sin declarar ausencia global",async()=>{
  const db=memoryDb({propiedades:[listing]});
  const found=await executeSalesTool(db,"check_sales_coverage",{location:"atrás de la laguna de Chapulco"},{socialContext:{}});
  assert.equal(found[0].covered,true);assert.equal(found[0].evidence,"published_inventory_match");
  const unknown=await executeSalesTool(db,"check_sales_coverage",{location:"Zona sintética desconocida"},{socialContext:{}});
  assert.equal(unknown[0].coverage,"coverage_unverified");
});
test("sin zone del modelo, fallback usa texto actual; no hardcode de Chapulco",async()=>{
  for(const title of [listing.titulo,"Casa en Venta Jardines Sintéticos, Vista al Parque"]){
    const db=memoryDb({propiedades:[{...listing,titulo:title,colonia:null,ciudad:null}]});
    const messageText=title===listing.titulo?query:"casa en Jardines Sintéticos";
    const result=await executeSalesTool(db,"search_sales_inventory",{operation:"sale"},{socialContext:{messageText}});
    assert.equal(result.listings[0]?.publicId,listing.public_id);
  }
});
test("origen validado precede texto pero nunca omite status ni filtros comerciales",async()=>{
  const {db,inbound}=fixture("El conde",{sourcePropertyId:listing.id});
  const context=await readSocialSalesContext(db,inbound,env);
  const found=await executeSalesTool(db,"search_sales_inventory",{zone:"otra zona"},{socialContext:context});
  assert.equal(found.listings[0].publicId,listing.public_id);assert.equal(found.sourceConfirmed,true);
  for(const args of [{operation:"rental"},{maxPrice:1000000},{minBedrooms:5}]){
    const result=await executeSalesTool(db,"search_sales_inventory",args,{socialContext:context});
    assert.equal(result.listings.length,0);
  }
  db.tables.propiedades[0].status="draft";
  assert.equal((await executeSalesTool(db,"search_sales_inventory",{},{socialContext:context})).listings.length,0);
});
test("query vacía nunca prueba ausencia de inventario; salida segura y guard del sender",()=>{
  for(const response of ["No me aparecen casas publicadas en Chapulco.","No tenemos casas en esa zona.","No hay propiedades disponibles."]){
    assert.equal(socialSalesOutput(response,{messageText:query}),SOCIAL_INVENTORY_CLARIFICATION);
    assert.equal(classifySafeSalesOutbound({messageText:query,calledTools:["search_sales_inventory"],proposedResponse:response,socialContext:{}}).eligible,false);
  }
});
test("nombres/model args no pueden crear source property y filtros no inyectan gramática PostgREST",()=>{
  const terms=inventoryTerms("Chapulco),status.eq.draft,%_*');--");
  assert.ok(terms.every(t=>/^[\p{L}\p{N}]+$/u.test(t)));assert.ok(terms.length<=4);
});
test("fulfill usa contexto server-side, ignora origen inventado en argumentos del modelo",async()=>{
  const {db,inbound}=fixture("El conde",{sourcePropertyId:listing.id});
  const context=await readSocialSalesContext(db,inbound,env),posts=[];
  await fulfillSalesActions({db,socialContext:context,env:{OPENAI_API_KEY:"synthetic"},seenToolCalls:new Set(),session:{id:"synthetic",required_actions:[{name:"search_sales_inventory",type:"function_call",arguments:{zone:"otra zona",sourcePropertyId:"invented"},call_id:"synthetic-call",turn_id:"synthetic-turn"}]},fetchImpl:async(url,options)=>{posts.push(JSON.parse(options.body));return {ok:true};}});
  const result=JSON.parse(posts[0].events[0].output);
  assert.equal(result.listings[0].publicId,listing.public_id);assert.equal(result.sourceConfirmed,true);
});

const loadSales = stubs => importWithStubs(new URL("../lib/agentsV2/runSalesShadowMessage.js",import.meta.url),{
  "./openaiSalesAgent":{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:async()=>assert.fail("unexpected model"),getSalesSession:async()=>assert.fail(),fulfillSalesActions:async()=>assert.fail(),salesSessionItems:async()=>assert.fail(),salesAssistantOutput:()=>assert.fail(),...stubs},
  "../ejecutivo/respondSync":{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:m=>m.at},
  "../shadow/coordinator":{sanitizeShadowText:text=>({text,rejected:false})},
});
test("El conde integrado: aclaración sin modelo, 0 handoff/assignment/reassignment/ACK",async()=>{
  const {db,inbound}=fixture("El conde");
  const runner=await loadSales({});
  const result=await runner.runSalesAgentV2ShadowMessage(db,inbound,{env});
  assert.equal(result.output,SOCIAL_CTA_CLARIFICATION);assert.equal(result.policyOnly,true);assert.deepEqual(result.calledTools,[]);
  assert.equal((await createSalesHandoffIfNeeded(db,{inbound,env})).created,false);
  assert.equal((await createSalesAutomationFallbackHandoff(db,{inbound,env})).created,false);
  const outbound=classifySafeSalesOutbound({messageText:inbound.sanitized_text,proposedResponse:result.output,socialContext:{}});
  assert.equal(outbound.eligible,true);assert.equal(outbound.caseKind,"greeting_qualification");
  assert.equal((db.tables.sales_agent_v2_handoffs||[]).length,0);
});
test("procesador persiste CTA policy-only, entrega sólo aclaración y duplicado no crea run/ACK",async()=>{
  const {db,inbound}=fixture("El conde"), runner=await loadSales({}), outbound=[];
  globalThis.fetch=async(url,options)=>{
    assert.ok(url.startsWith("https://api.respond.io/"),"no assignment workflow/model");
    const body=JSON.parse(options.body);assert.equal(body.message.text,SOCIAL_CTA_CLARIFICATION);
    outbound.push(body.message.text);return {ok:true,json:async()=>({messageId:"synthetic-clarification"})};
  };
  const process=await importWithStubs(new URL("../lib/agentsV2/processSalesInbound.js",import.meta.url),{
    "./runSalesShadowMessage":runner,
    "./salesHandoff":{createSalesHandoffIfNeeded,dispatchSalesHandoff},
    "./salesAutoOutbound":{processSalesAutoOutboundRun:async(db,id,options)=>{
      // Supply the existing FK read-back relation in this in-memory fixture.
      db.tables.sales_agent_v2_shadow_runs.find(r=>r.id===id).sales_agent_v2_inbound_messages=inbound;
      return processSalesAutoOutboundRun(db,id,options);
    }},
    "./agentUsage":{safeAgentUsage:async(sessionId,{model})=>{assert.match(sessionId,/^human-review-social-cta-/);assert.equal(model,null);return {inputTokens:0,outputTokens:0,totalTokens:0};}},
    "./openaiSalesAgent":{salesAgentModel:()=>assert.fail("no configured model inferred")},
  });
  assert.equal((await process.processSalesInboundById(db,inbound.id,{env})).status,"processed");
  assert.equal((await process.processSalesInboundById(db,inbound.id,{env})).status,"not_claimed");
  assert.equal(db.tables.sales_agent_v2_shadow_runs.length,1);
  assert.equal(db.tables.sales_agent_v2_shadow_runs[0].model,null);
  assert.equal(db.tables.sales_agent_v2_shadow_runs[0].proposed_response,SOCIAL_CTA_CLARIFICATION);
  assert.deepEqual(outbound,[SOCIAL_CTA_CLARIFICATION]);assert.equal((db.tables.sales_agent_v2_handoffs||[]).length,0);
  assert.equal(db.tables.sales_agent_v2_auto_outbound.length,1);
  globalThis.fetch=async()=>assert.fail("real network forbidden");
});
test("pipeline real con modelo sintético: origen antes de historia, contexto llega a tool, falso negativo no persiste",async()=>{
  const {db,inbound}=fixture(query,{sourcePropertyId:listing.id});let inputs=[],calls=0;
  const runner=await loadSales({createSalesSession:async({input})=>{inputs.push(input);return {id:"synthetic"};},getSalesSession:async()=>({id:"synthetic",status:++calls===1?"requires_action":"idle",required_actions:[{name:"search_sales_inventory"}]}),fulfillSalesActions:async({socialContext})=>{assert.equal(socialContext.sourcePropertyId,listing.id);return 1;},salesSessionItems:async()=>[],salesAssistantOutput:()=>"No me aparecen casas publicadas."});
  const result=await runner.runSalesAgentV2ShadowMessage(db,inbound,{env});
  assert.ok(inputs[0].indexOf(listing.public_id)<inputs[0].indexOf("Historial reciente"));
  assert.equal(result.output,SOCIAL_INVENTORY_CLARIFICATION);
});
test("sender bloquea resultado viejo negativo aun si ya estaba persistido",async()=>{
  const {db,inbound}=fixture(query);
  db.tables.sales_agent_v2_shadow_runs=[{id:"run",status:"idle",completed_at:new Date().toISOString(),called_tools:["search_sales_inventory"],proposed_response:"No me aparecen casas publicadas.",sales_agent_v2_inbound_messages:inbound}];
  assert.equal((await processSalesAutoOutboundRun(db,"run",{env})).reason,"inventory_absence_not_proven");
  assert.equal((db.tables.sales_agent_v2_auto_outbound||[]).length,0);
});
test("flag OFF: ninguna lectura social, schema/contrato legacy de inventario conserva array",async()=>{
  assert.equal(await readSocialSalesContext({from(){assert.fail();}},{channel_id:"498219"},{}),null);
  assert.equal(classifySalesHandoff("mostrar").reason,"appointment_intent");
  assert.ok(Array.isArray(await executeSalesTool(memoryDb({propiedades:[listing]}),"search_sales_inventory",{})));
  assert.equal(socialSalesOutput("No hay casas publicadas",null),"No hay casas publicadas");
});
