import test, { after } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/socialSalesConversation.mjs";
import { memoryDb } from "./helpers/socialFixtures.mjs";
import { SOCIAL_CHANNELS } from "../lib/social/routing.js";
import { explicitSalesSearch, socialSearchFilters } from "../lib/social/salesSearchContext.js";
import { inventoryTerms, socialSalesOutput } from "../lib/social/salesInventory.js";
import { executeSalesTool, fulfillSalesActions } from "../lib/agentsV2/openaiSalesAgent.js";
import { SOCIAL_INVENTORY_CLARIFICATION } from "../lib/social/commercialIntent.js";

// Exact user-provided incident wording. The contact, inventory, preceding AI
// question, responses and all channel variants are synthetic, not a live replay.
const exact="Renta de casa en san Andrés Cholula o alrededores PET friendly máximo 11000 pesos";
const filters={operation:"rental",propertyType:"Casa",zone:"san Andrés Cholula",nearbyRequested:true,maxPrice:11000,petsAllowed:true};
const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;});
const listing={id:"qa-emi-house",public_id:"EMP-QA-HOUSE",titulo:"Casa QA",colonia:"San Andrés Cholula",ciudad:"Puebla",
  status:"published",operacion:"rental",tipo:"Casa",precio:10500,moneda:"MXN",mascotas_permitidas:true};
const tools=[{name:"check_sales_coverage",args:{location:"san Andrés Cholula"}},
  // Deliberately bad model arguments: the explicit customer criteria must win.
  {name:"search_sales_inventory",args:{zone:exact,city:"San Andrés Cholula",maxPrice:15000,petsAllowed:false}}];
const safeMatch="La publicación EMP-QA-HOUSE indica una casa en San Andrés Cholula por $10,500 MXN y permite mascotas. La disponibilidad actual debe verificarse.";
const retained=text=>{
  assert.match(text,/casa en renta en san Andrés Cholula/i);
  assert.match(text,/11,000/);assert.match(text,/mascotas/);
  assert.doesNotMatch(text,/esa publicación|comparte.*enlace|¿.*(?:presupuesto|renta o|tipo de inmueble)/i);
};

test("explicit criteria survive short follow-up, no budget/pets as geography",()=>{
  const search=explicitSalesSearch([exact,"Renta de casa"]);
  assert.deepEqual(search,{intent:"general_search",filters});
  assert.deepEqual(inventoryTerms(exact),["san","andrés","cholula"]);
  assert.deepEqual(socialSearchFilters(tools[1].args,{search}),{operation:"rental",propertyType:"Casa",zone:"san Andrés Cholula",maxPrice:11000,petsAllowed:true});
  assert.equal(explicitSalesSearch([exact,"Ahora mi presupuesto máximo es 13000"]).filters.maxPrice,11000,"unrecognized wording does not silently widen");
  assert.equal(explicitSalesSearch([exact,"Ahora hasta 13000"]).filters.maxPrice,13000,"explicit recognized change can update budget");
});

for(const [channelId,channel] of Object.entries(SOCIAL_CHANNELS))for(const outcome of ["matched","empty","error"])
test(`${channel}: exact incident conversation / ${outcome} / short follow-up / duplicates`,async()=>{
  const h=await harness(channelId,{assigned:true});
  await h.step("Busco opciones de casas","¿Buscas renta o compra, en qué zona y con qué presupuesto?");
  h.db.tables.propiedades=outcome==="empty"?[]:[listing,
    {...listing,id:"over-budget",precio:12000}, {...listing,id:"no-pets",mascotas_permitidas:false},
    {...listing,id:"unknown-pets",mascotas_permitidas:null}, {...listing,id:"wrong-zone",colonia:"Otra zona"},
    {...listing,id:"not-published",status:"draft"}];
  if(outcome==="error"){
    const from=h.db.from.bind(h.db);
    h.db.from=table=>{
      const q=from(table);
      if(table==="propiedades")q.then=(yes,no)=>Promise.resolve({data:null,error:new Error("synthetic_inventory_failure")}).then(yes,no);
      return q;
    };
  }
  const expected=text=>{
    if(outcome==="matched")assert.equal(text,safeMatch);
    else {
      retained(text);
      if(outcome==="empty"){assert.match(text,/no devolvió coincidencias verificadas/);assert.match(text,/qué zonas de los alrededores/);}
      else {assert.match(text,/consulta de inventario falló/);assert.doesNotMatch(text,/no devolvió|esa publicación/);}
    }
  };
  await h.step(exact,outcome==="matched"?safeMatch:SOCIAL_INVENTORY_CLARIFICATION,tools,expected);
  const inventory=h.toolResults.find(x=>x.searchEvidence);
  if(outcome!=="error"){
    assert.equal(inventory.searchEvidence.status,outcome);
    assert.deepEqual(inventory.listings.map(x=>x.publicId),outcome==="matched"?[listing.public_id]:[]);
    assert.equal(inventory.searchIntent,"general_search");
    assert.deepEqual(inventory.searchEvidence.filters,{operation:"rental",propertyType:"Casa",zone:"san Andrés Cholula",maxPrice:11000,petsAllowed:true});
  }else assert.ok(h.toolResults.some(x=>x.toolError));
  // Short turn omits all geography/budget/pets. The real runner restores them
  // from persisted inbound history, not from another model's recollection.
  await h.step("Renta de casa",outcome==="matched"?safeMatch:SOCIAL_INVENTORY_CLARIFICATION,
    [{name:"search_sales_inventory",args:{operation:"rental",propertyType:"Casa"}}],expected);
  const prompt=h.sessions.at(-1).input;
  for(const value of ['"maxPrice":11000','"petsAllowed":true','"zone":"san Andrés Cholula"'])assert.ok(prompt.includes(value));
  assert.equal(h.sends.length,3);assert.equal(h.db.tables.sales_agent_v2_shadow_runs.length,3);
  assert.equal(h.db.tables.sales_agent_v2_auto_outbound.filter(r=>r.status==="sent").length,3);
});

test("general follow-up without tool keeps criteria and does not invent a search result",async()=>{
  const h=await harness("498219");
  await h.step(exact,"¿Quieres mantener esos requisitos?");
  await h.step("Renta de casa",SOCIAL_INVENTORY_CLARIFICATION,[],text=>{
    retained(text);assert.doesNotMatch(text,/no devolvió|falló/);
  });
});

test("general search guard is semantic, not only replacement of one fixed sentence",()=>{
  for(const output of ["¿A qué publicación te refieres?", "¿Me compartes el enlace para identificar la propiedad?", "No puedo identificar la propiedad"]){
    const result=socialSalesOutput(output,{messageText:exact,search:explicitSalesSearch([exact])});
    retained(result);assert.doesNotMatch(result,/no devolvió|falló/);
  }
});

test("coverage failure remains technical, never empty inventory",async()=>{
  const context={messageText:exact,search:explicitSalesSearch([exact])};
  const db={from:()=>{throw new Error("synthetic_coverage_error");}};
  let events;
  await fulfillSalesActions({db,socialContext:context,env:{OPENAI_API_KEY:"synthetic"},session:{id:"synthetic",required_actions:[
    {name:"check_sales_coverage",type:"function_call",arguments:{location:"Ubicación sintética"},call_id:"q",turn_id:"t"}]},fetchImpl:async(_url,options)=>{events=JSON.parse(options.body).events;return{ok:true};}});
  assert.equal(events[0].success,false);assert.equal(context.inventory.status,"error");
  assert.equal(context.inventory.matchCount,null);
  const output=socialSalesOutput("No hay casas disponibles",context);
  retained(output);assert.match(output,/consulta de inventario falló/);
});

test("specific reference retains clarification; error remains technical even for a reference",async()=>{
  for(const messageText of ["Esa casa de la publicación", "Me interesa [URL]", "La casa que indicas en Cholula"]){
    const context={messageText,search:explicitSalesSearch([messageText]),inventory:{status:"empty",matchCount:0,filters:{zone:"Cholula"}}};
    assert.equal(socialSalesOutput("No hay casas",context),SOCIAL_INVENTORY_CLARIFICATION);
    context.inventory.status="error";context.inventory.matchCount=null;
    assert.match(socialSalesOutput("No hay casas",context),/consulta de inventario falló/);
  }
});

test("technical error has no zero matchCount and malformed data is not empty",async()=>{
  const context={messageText:exact,search:explicitSalesSearch([exact])};
  const db=memoryDb({propiedades:[]}),from=db.from.bind(db);
  db.from=table=>{const q=from(table);q.then=(yes,no)=>Promise.resolve({data:null,error:null}).then(yes,no);return q;};
  await assert.rejects(()=>executeSalesTool(db,"search_sales_inventory",{},{socialContext:context}),/inventory_result_invalid/);
  assert.equal(context.inventory.status,"error");assert.equal(context.inventory.matchCount,null);
  let events;
  await fulfillSalesActions({db,socialContext:context,env:{OPENAI_API_KEY:"synthetic"},session:{id:"synthetic",required_actions:[
    {name:"search_sales_inventory",type:"function_call",arguments:{},call_id:"q",turn_id:"t"}]},fetchImpl:async(_url,options)=>{events=JSON.parse(options.body).events;return{ok:true};}});
  assert.equal(events[0].success,false);assert.equal(context.inventory.matchCount,null);
});

for(const moment of ["before_model","after_model"])
test(`human pause ${moment} blocks inventory response and subsequent inbound`,async()=>{
  const h=await harness("498219",{assigned:true});
  h.db.tables.propiedades=[listing];
  if(moment==="before_model")h.state.paused=true;
  else h.state.pauseAfterModel=true;
  await h.step(exact,safeMatch,tools,null);
  assert.equal(h.sends.length,0);
  const count=h.sessions.length;
  assert.equal(count,moment==="before_model"?0:1);
  await h.step("Renta de casa",safeMatch,tools,null);
  assert.equal(h.sessions.length,count);assert.equal(h.sends.length,0);
});
