import { constrainSocialLocation, inventoryTerms, searchSocialInventory } from "../social/salesInventory.js";
import { socialSearchFilters } from "../social/salesSearchContext.js";

const SALES_TOOLS=Object.freeze([
  "get_sales_contact_profile",
  "check_sales_coverage",
  "search_sales_inventory",
  "get_rental_requirements",
]);

const TOOL_SCHEMAS=Object.freeze({
  get_sales_contact_profile:{
    type:"object",additionalProperties:false,required:["respondContactId"],
    properties:{respondContactId:{type:"string",minLength:1,maxLength:120}},
  },
  check_sales_coverage:{
    type:"object",additionalProperties:false,required:["location"],
    properties:{location:{type:"string",minLength:1,maxLength:120}}
  },
  search_sales_inventory:{
    type:"object",additionalProperties:false,
    properties:{
      operation:{type:"string",enum:["sale","rental"]},
      zone:{type:"string",maxLength:120},
      city:{type:"string",maxLength:120},
      propertyType:{type:"string",maxLength:120},
      maxPrice:{type:"number",minimum:0},
      minBedrooms:{type:"number",minimum:0,maximum:20},
      petsAllowed:{type:"boolean"},
      furnished:{type:"string",maxLength:80}
    }
  },
  get_rental_requirements:{
    type:"object",additionalProperties:false,
    properties:{
      topic:{type:"string",enum:["general","documents","policy","process","contract_conditions"]}
    }
  }
});

const DESCRIPTIONS=Object.freeze({
  get_sales_contact_profile:"Read the current commercial Respond snapshot for this contact: area, service, budget, target rent, timing, desired property type, zone and assigned advisor. Do not infer missing fields.",
  check_sales_coverage:"Check whether a requested city or zone is within Emporio's current commercial coverage. Use this before searching inventory whenever the prospect names a geographic location.",
  search_sales_inventory:"Search only currently published Emporio listings in the canonical sales inventory using explicit commercial filters. Return up to 5 matches.",
  get_rental_requirements:"Read Emporio's current standard rental requirements and legal-policy process. Use this for questions like what is needed to rent, required documents, legal policy, investigation process, deposits and standard contract conditions. Never use it to approve or reject a candidate.",
});

const headers=(env)=>({
  Authorization:"Bearer "+env.OPENAI_API_KEY,
  "Content-Type":"application/json",
  "OpenAI-Beta":"agents=v1",
});

export function salesAgentModel(env=process.env){
  return env.OPENAI_SALES_AGENT_MODEL||env.OPENAI_ADMIN_AGENT_MODEL;
}

export function assertSalesAgentV2ShadowEnvironment(env=process.env){
  if(env.SALES_AGENT_V2_ENABLED!=="true") throw new Error("sales_agent_v2_disabled");
  if(env.VERCEL_ENV!=="production"||env.SUPABASE_ENVIRONMENT!=="production") throw new Error("sales_agent_v2_environment_mismatch");
  if(env.SALES_AGENT_V2_PRODUCTION_SHADOW_ENABLED!=="true") throw new Error("sales_agent_v2_production_shadow_disabled");
  if(!env.OPENAI_API_KEY) throw new Error("openai_api_key_required");
  if(!salesAgentModel(env)) throw new Error("openai_sales_agent_model_required");
  return true;
}

export function buildSalesAgentV2Tools(){
  return SALES_TOOLS.map((name)=>({type:"function",name,description:DESCRIPTIONS[name],parameters:TOOL_SCHEMAS[name]}));
}

export function buildSalesAgentV2Config(env=process.env){
  return{
    model:salesAgentModel(env),
    instructions:[
      "Eres el Agente de Ventas IA de Emporio Inmobiliario en modo Shadow. No envías mensajes.",
      "Tu objetivo es entender qué inmueble busca el prospecto y avanzar hacia una cita, sin inventar inventario ni disponibilidad.",
      "El perfil comercial suele venir ya resuelto en el contexto por Inmoadmin. No llames get_sales_contact_profile si ese bloque está presente y suficiente; úsalo sólo como respaldo cuando falte o sea insuficiente.",
      "Si el prospecto menciona una ciudad, municipio o zona nueva que todavía no esté resuelta en el contexto, consulta check_sales_coverage antes de buscar inventario. No repitas la consulta si la cobertura ya quedó resuelta en esta conversación.",
      "La cobertura comercial vigente es Puebla y zona metropolitana; y Veracruz puerto, Boca del Río, Riviera Veracruzana y Alvarado.",
      "Si la ubicación solicitada está fuera de cobertura, indícalo claramente y no busques inventario ni pidas presupuesto para esa ubicación.",
      "Usa search_sales_inventory sólo con filtros que el prospecto haya expresado o que existan en el perfil comercial. No repitas la misma búsqueda dentro de una sesión si los filtros no cambiaron.",
      "Sólo considera propiedades publicadas. Nunca ofrezcas archived, reserved o leased.",
      "Si faltan datos críticos, pregunta de forma breve por lo mínimo necesario: operación, zona, presupuesto y tipo de inmueble.",
      "Cuando el prospecto pregunte qué necesita para rentar, requisitos, documentos, depósito, contrato o póliza jurídica, consulta get_rental_requirements y explica únicamente el estándar vigente.",
      "Puedes explicar requisitos generales y el proceso de póliza, pero nunca aprobar, rechazar, predecir el dictamen, dispensar documentos ni autorizar excepciones. Si el prospecto pregunta por su caso particular o por una excepción, indica que debe revisarlo Jurídico.",
      "No prometas descuentos, créditos, aceptación de póliza, disponibilidad futura ni condiciones del propietario.",
      "Si hay coincidencias, menciona máximo 3 opciones con nombre, zona, precio y rasgos útiles. Cuando una opción tenga publicUrl, incluye esa liga pública canónica. Nunca inventes enlaces ni compartas ligas de propiedades no publicadas.",
      "No propongas una cita de forma automática cuando el prospecto apenas está pidiendo información u opciones. Primero informa, aclara filtros y muestra inventario. Sólo menciona visita/cita cuando el prospecto exprese interés claro en una propiedad o pida verla; en ese caso no confirmes horario y deja el handoff preparado para un asesor.",
      "Si el mensaje actual es sólo una confirmación breve, agradecimiento, 'ok', 'sí', 'o así', una petición de foto de la propiedad ya conversada o un seguimiento contextual que no cambia filtros, no vuelvas a ejecutar cobertura ni inventario salvo que sea estrictamente necesario.",
      "Responde en español mexicano, natural y breve.",
      "Si es el primer mensaje útil de la conversación o no hay una respuesta reciente de Emporio, inicia con un saludo breve y natural (por ejemplo: Hola, claro, con gusto). En seguimientos posteriores no vuelvas a saludar salvo que el contexto lo amerite.",
      "Las respuestas deben ser compatibles con WhatsApp, Instagram, Messenger y TikTok: no uses Markdown, asteriscos para negritas, encabezados ni enlaces con formato [texto](url). Si compartes una propiedad, escribe la URL pública directa en una línea legible.",
      "La salida debe ser exclusivamente el texto final que se enviaría al prospecto. Nunca incluyas etiquetas o notas internas como Respuesta sugerida, Siguiente pregunta sugerida, Modo Shadow, No se envió ningún mensaje, análisis, herramientas usadas ni instrucciones para asesores.",
    ].join("\n"),
    tools:buildSalesAgentV2Tools(),
  };
}

export async function executeSalesTool(db,name,args,{socialContext=null}={}){
  if(!SALES_TOOLS.includes(name)) throw new Error("sales_tool_not_allowlisted");
  if(name==="get_sales_contact_profile"){
    const id=String(args?.respondContactId||"").trim();
    if(!id) throw new Error("invalid_tool_arguments");
    const {data,error}=await db.from("gv_respond_contact_snapshots")
      .select("respond_contact_id,mapped_profile_id,mapping_status,respond_conversation_status,respond_lifecycle,atn_area,atn_servicio,atn_estado,atn_destino,atn_proxima_accion,atn_fecha_proxima_accion,ven_presupuesto_compra,ven_renta_mensual_objetivo,ven_plazo,inm_tipo,inm_zona,sales_relevant,respond_record_active,respond_blocked")
      .eq("respond_contact_id",id).maybeSingle();
    if(error) throw error;
    return data?[{
      resolved:true,
      respondContactId:data.respond_contact_id,
      assignedProfileId:data.mapped_profile_id,
      mappingStatus:data.mapping_status,
      conversationStatus:data.respond_conversation_status,
      lifecycle:data.respond_lifecycle,
      area:data.atn_area,
      service:data.atn_servicio,
      state:data.atn_estado,
      destination:data.atn_destino,
      nextAction:data.atn_proxima_accion,
      nextActionDate:data.atn_fecha_proxima_accion,
      purchaseBudget:data.ven_presupuesto_compra,
      targetRent:data.ven_renta_mensual_objetivo,
      timeframe:data.ven_plazo,
      propertyType:data.inm_tipo,
      zone:data.inm_zona,
      salesRelevant:Boolean(data.sales_relevant),
      active:Boolean(data.respond_record_active),
      blocked:Boolean(data.respond_blocked),
    }]:[{resolved:false,status:"sales_snapshot_not_found"}];
  }
  if(name==="check_sales_coverage"){
    const raw=String(args?.location||"").trim();
    const location=raw.toLowerCase();
    if(!location) throw new Error("invalid_tool_arguments");
    const normalized=location.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const directCovered=[
      "puebla","cholula","san andres cholula","san pedro cholula","cuautlancingo","coronango","tlaxcalancingo",
      "veracruz","boca del rio","riviera veracruzana","alvarado","central de abastos"
    ].some((term)=>normalized.includes(term));

    let inventoryEvidence=false;
    if(!directCovered){
      const safe=raw.slice(0,80);
      let query=db.from("propiedades")
        .select("id")
        .eq("status","published")
        .limit(1);
      if(socialContext){
        // Absence of geographic evidence is unknown, not proof of no coverage.
        query=inventoryTerms(raw).length ? constrainSocialLocation(query,raw) : query.eq("id",socialContext.sourcePropertyId||"00000000-0000-0000-0000-000000000000");
      }else query=query.or("colonia.ilike.%"+safe+"%,ciudad.ilike.%"+safe+"%,titulo.ilike.%"+safe+"%,direccion.ilike.%"+safe+"%");
      const {data,error}=await query;
      if(error) throw error;
      inventoryEvidence=(data||[]).length>0;
    }

    const covered=directCovered||inventoryEvidence;
    return [{
      location:raw.slice(0,120),
      covered,
      coverage:covered
        ?"Puebla y zona metropolitana; Veracruz puerto, Boca del Río, Riviera Veracruzana y Alvarado"
        :socialContext?"coverage_unverified":"outside_current_coverage",
      evidence:directCovered?"coverage_alias":inventoryEvidence?"published_inventory_match":"no_coverage_evidence"
    }];
  }
  if(name==="get_rental_requirements"){
    const topic=String(args?.topic||"general");
    const canonical={
      general:{
        requirements:[
          "INE vigente",
          "Comprobantes de ingresos de los últimos 3 meses",
          "Solicitud de arrendamiento completa",
          "Cubrir el costo de la Póliza Jurídica"
        ],
        standardConditions:[
          "1 mes de renta como pago inicial",
          "1 mes de depósito en garantía",
          "Contrato estándar por 1 año",
          "Póliza Jurídica obligatoria; generalmente la paga el inquilino"
        ]
      },
      documents:{
        requirements:[
          "INE vigente",
          "Comprobantes de ingresos de los últimos 3 meses",
          "Solicitud de arrendamiento completa",
          "Documentación adicional que Jurídico solicite según el expediente"
        ]
      },
      policy:{
        mandatory:true,
        paidBy:"Generalmente la paga el inquilino",
        includes:[
          "Investigación del candidato",
          "Validación de ingresos y documentos",
          "Referencias personales, laborales y familiares",
          "Consulta en Buró México",
          "Contrato redactado por especialistas",
          "Cobertura jurídica durante la vigencia",
          "Recuperación judicial si aplica"
        ],
        outcome:"Jurídico emite un dictamen formal; Ventas no puede prometer aprobación."
      },
      process:{
        steps:[
          "Apartado",
          "Solicitud y carga de documentos",
          "Investigación de póliza",
          "Dictamen",
          "Firma de contrato y pagarés",
          "Entrega conforme a las condiciones acordadas"
        ]
      },
      contract_conditions:{
        standard:[
          "1 mes de renta como pago inicial",
          "1 mes de depósito en garantía",
          "Contrato por 1 año",
          "Póliza Jurídica obligatoria",
          "Se firman pagarés independientes al contrato"
        ]
      }
    };
    return [{topic, ...(canonical[topic]||canonical.general), source:"Emporio Inmobiliario · Guías operativas vigentes"}];
  }
  if(name==="search_sales_inventory"){
    if(socialContext) args=socialSearchFilters(args,socialContext);
    const makeQuery=()=>{
      let q=db.from("propiedades")
      .select("id,public_id,titulo,operacion,precio,moneda,tipo,recamaras,banos,estacionamientos,m2_construccion,m2_terreno,colonia,ciudad,estado,amenidades,mantenimiento_monto,mantenimiento_aplica,fecha_disponibilidad,mascotas_permitidas,amueblado,creditos_aceptados,status,plaza_id")
      .eq("status","published")
      .order("updated_at",{ascending:false})
      .limit(5);
    if(args?.operation) q=q.eq("operacion",args.operation);
    if(args?.zone&&!socialContext){
      const z=String(args.zone).slice(0,80);
      q=q.or("colonia.ilike.%"+z+"%,ciudad.ilike.%"+z+"%,titulo.ilike.%"+z+"%");
    }
    if(args?.city) q=q.ilike("ciudad","%"+String(args.city).slice(0,80)+"%");
    if(args?.propertyType) q=q.ilike("tipo","%"+String(args.propertyType).slice(0,80)+"%");
    if(Number.isFinite(args?.maxPrice)) q=q.lte("precio",args.maxPrice);
    if(Number.isFinite(args?.minBedrooms)) q=q.gte("recamaras",args.minBedrooms);
    if(typeof args?.petsAllowed==="boolean") q=q.eq("mascotas_permitidas",args.petsAllowed);
    if(args?.furnished) q=q.ilike("amueblado","%"+String(args.furnished).slice(0,60)+"%");
    return q;
    };
    let data;
    if(socialContext) data=await searchSocialInventory(makeQuery,args,socialContext);
    else { const result=await makeQuery(); if(result.error)throw result.error; data=result.data; }
    const listings=(data||[]).map((x)=>({
      propertyId:x.id,publicId:x.public_id,
      publicUrl:x.public_id ? "https://www.emporioinmobiliario.com.mx/propiedades/"+encodeURIComponent(String(x.public_id)) : null,
      title:x.titulo,operation:x.operacion,price:x.precio,currency:x.moneda,
      propertyType:x.tipo,bedrooms:x.recamaras,bathrooms:x.banos,parking:x.estacionamientos,
      constructionM2:x.m2_construccion,landM2:x.m2_terreno,zone:x.colonia,city:x.ciudad,state:x.estado,
      maintenanceApplies:Boolean(x.mantenimiento_aplica),maintenanceAmount:x.mantenimiento_monto,
      availableFrom:x.fecha_disponibilidad,petsAllowed:x.mascotas_permitidas,furnished:x.amueblado,
      creditsAccepted:x.creditos_aceptados,
    }));
    return socialContext ? {listings,searchEvidence:socialContext.inventory,searchIntent:socialContext.search.intent,sourceConfirmed:socialContext.inventory?.evidence==="verified_source_property",instruction:"Los resultados son candidatos publicados, no disponibilidad confirmada. Respeta todos los filtros, incluidas mascotas. Una búsqueda general vacía no es una publicación sin identificar: conserva requisitos y pide sólo datos faltantes; no amplíes sin consentimiento. Sólo una referencia concreta sin resolver admite pedir enlace/ubicación. Un error técnico no es inventario vacío."} : listings;
  }
  throw new Error("sales_tool_not_implemented");
}

export async function createSalesSession({input,env=process.env,fetchImpl=fetch}){
  assertSalesAgentV2ShadowEnvironment(env);
  const response=await fetchImpl("https://api.openai.com/v1/agents/sessions",{
    method:"POST",headers:headers(env),
    body:JSON.stringify({
      agent:buildSalesAgentV2Config(env),
      environment:{type:"none"},
      input:String(input||"").slice(0,5000),
      stream:false,
      metadata:{system:"inmoadmin",mode:"sales_agent_v2_shadow"},
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body?.id) throw new Error("sales_agent_v2_create_failed_"+response.status);
  return body;
}

export async function getSalesSession({sessionId,env=process.env,fetchImpl=fetch}){
  const delays=[0,300,900,1800];
  for(const delay of delays){
    if(delay) await new Promise(r=>setTimeout(r,delay));
    const response=await fetchImpl("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(sessionId),{headers:headers(env)});
    const body=await response.json().catch(()=>({}));
    if(response.ok)return body;
    if(response.status!==429&&response.status<500) throw new Error("sales_agent_v2_retrieve_failed_"+response.status);
  }
  throw new Error("sales_agent_v2_retrieve_failed");
}

export async function fulfillSalesActions({db,session,env=process.env,fetchImpl=fetch,seenToolCalls,socialContext=null}){
  const calls=(session?.required_actions||[]).filter((a)=>a?.type==="function_call"&&SALES_TOOLS.includes(a?.name));
  if(!calls.length)return 0;
  const events=[];
  const seen=seenToolCalls instanceof Set?seenToolCalls:new Set();
  for(const call of calls){
    const args=call.arguments||{};
    const key=call.name+":"+JSON.stringify(args,Object.keys(args||{}).sort());
    if(seen.has(key)){
      events.push({type:"agent.session.input.tool_result",turn_id:call.turn_id,call_id:call.call_id,success:true,output:JSON.stringify([{status:"duplicate_tool_call_skipped",tool:call.name}])});
      continue;
    }
    seen.add(key);
    try{
      const output=await executeSalesTool(db,call.name,args,{socialContext});
      events.push({type:"agent.session.input.tool_result",turn_id:call.turn_id,call_id:call.call_id,success:true,output:JSON.stringify(output)});
    }catch(error){
      if(socialContext && ["search_sales_inventory","check_sales_coverage"].includes(call.name))
        socialContext.inventory={status:"error",evidence:"tool_failed",matchCount:null,filters:socialContext.search?.filters||{}};
      events.push({type:"agent.session.input.tool_result",turn_id:call.turn_id,call_id:call.call_id,success:false,error:String(error?.message||"tool_failed").slice(0,120)});
    }
  }
  const response=await fetchImpl("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(session.id)+"/events",{
    method:"POST",headers:headers(env),body:JSON.stringify({events})
  });
  if(!response.ok)throw new Error("sales_agent_v2_tool_result_failed_"+response.status);
  return events.length;
}

export async function salesSessionItems(sessionId,env=process.env){
  const response=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(sessionId)+"/items?order=asc&limit=100",{
    headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"OpenAI-Beta":"agents=v1"}
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("sales_agent_v2_items_failed_"+response.status);
  return Array.isArray(body?.data)?body.data:[];
}

export function salesAssistantOutput(items){
  const assistant=[...items].reverse().find((item)=>item?.role==="assistant");
  return(assistant?.content||[]).map((part)=>part?.text||part?.output_text||"").filter(Boolean).join("\n").slice(0,3000);
}
