import test, { after } from "node:test";
import assert from "node:assert/strict";
import { classifySocialRoute, SOCIAL_CHANNELS } from "../lib/social/routing.js";

// User-supplied incident phrase, with synthetic identities only. No credentials,
// real models, provider calls, production fixtures or retrospective deliveries.
const exact = "Hola buenas tardes, tendra opciones de departamentos en zona centro, el carmen o cu?";
const queries = [exact, "Hola buenas tardes, tendrá opciones de departamentos en zona centro, El Carmen o CU?", "¿Tienen opciones de departamentos en Centro, El Carmen o CU?", "¿Manejan departamentos por Centro, El Carmen o CU?",
  "¿Tienen opciones de departamentos?", "¿Manejan departamentos?"];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("real network forbidden");
after(() => { globalThis.fetch = originalFetch; });

import { harness } from "./helpers/socialSalesConversation.mjs";

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
test(`${platform}: empty general search retains criteria instead of inventing a publication reference`,async()=>{
  const h=await harness(channelId);
  h.db.tables.propiedades=[];
  await h.step(exact,"Hola, revisamos Centro, El Carmen o CU. ¿Buscas departamento en renta o en venta y cuál es tu presupuesto?");
  await h.step("Quiero departamentos en renta en Centro de Puebla, hasta 10000",
    "Con esos filtros no tengo una coincidencia verificada. ¿Puedes ampliar el presupuesto o considerar otra colonia?",[
      {name:"check_sales_coverage",args:{location:"Puebla"}},
      {name:"search_sales_inventory",args:{operation:"rental",zone:"Centro",city:"Puebla",propertyType:"Departamento",maxPrice:10000}},
    ],"La búsqueda consultada no devolvió coincidencias verificadas para departamento en renta en Centro de Puebla con presupuesto máximo de $10,000 MXN. Esto no descarta otras publicaciones ni confirma disponibilidad. Mantengo estos requisitos; sólo los cambiaré si tú me lo indicas.");
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
