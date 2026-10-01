const OWNER_TOOLS=Object.freeze(["get_owner_service_info","check_owner_coverage"]);

const schemas={
  get_owner_service_info:{
    type:"object",additionalProperties:false,
    properties:{topic:{type:"string",enum:["general","rental_marketing","sale_marketing","management","process"]}}
  },
  check_owner_coverage:{
    type:"object",additionalProperties:false,required:["location"],
    properties:{location:{type:"string",minLength:1,maxLength:120}}
  }
};

const descriptions={
  get_owner_service_info:"Read Emporio's current standard services and fees for property owners: rental placement, sale brokerage, property management and first-step process.",
  check_owner_coverage:"Check whether an owner's property is within Emporio's current operating coverage."
};

const headers=(env)=>({Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json","OpenAI-Beta":"agents=v1"});
const model=(env)=>env.OPENAI_OWNER_AGENT_MODEL||env.OPENAI_SALES_AGENT_MODEL||env.OPENAI_ADMIN_AGENT_MODEL;

export function assertOwnerAgentEnvironment(env=process.env){
  if(env.VERCEL_ENV!=="production"||env.SUPABASE_ENVIRONMENT!=="production")throw new Error("owner_agent_environment_mismatch");
  if(!env.OPENAI_API_KEY||!model(env))throw new Error("owner_agent_configuration_missing");
}

export function ownerAgentConfig(env=process.env){
  return{
    model:model(env),
    instructions:[
      "Eres Propietarios IA de Emporio Inmobiliario.",
      "Atiendes exclusivamente a dueños de inmuebles que quieren vender, rentar, publicar o contratar administración.",
      "Primero entiende: servicio deseado, ciudad/zona, tipo de inmueble y precio/renta aproximada si ya lo conoce.",
      "Consulta get_owner_service_info antes de explicar honorarios o servicios.",
      "Consulta check_owner_coverage cuando mencione ubicación.",
      "Honorarios estándar verificados: colocación en renta = 1 mes de renta; venta = 5% del valor de venta; administración = 10% mensual.",
      "No prometas precio de mercado, tiempo de colocación, comprador/inquilino, rendimiento ni aceptación de una propiedad sin revisión.",
      "Si pregunta cuánto vale su inmueble, explica que requiere una opinión de valor/revisión del inmueble; no inventes un precio.",
      "Cuando el propietario quiera avanzar, pide sólo lo mínimo útil para continuar: zona, tipo de inmueble y si busca venta, renta o administración.",
      "Responde en español mexicano, natural, breve y sin Markdown. No uses encabezados ni asteriscos.",
      "No expongas notas internas. La salida es sólo el texto listo para enviar al propietario."
    ].join("\n"),
    tools:OWNER_TOOLS.map(name=>({type:"function",name,description:descriptions[name],parameters:schemas[name]}))
  };
}

export async function executeOwnerTool(name,args){
  if(name==="get_owner_service_info"){
    const topic=String(args?.topic||"general");
    const info={
      general:{
        services:["Promoción para renta","Promoción para venta","Administración de propiedades"],
        rentalPlacementFee:"1 mes de renta",
        saleFee:"5% del valor de venta",
        managementFee:"10% mensual"
      },
      rental_marketing:{service:"Promoción y colocación en renta",fee:"1 mes de renta"},
      sale_marketing:{service:"Promoción y venta",fee:"5% del valor de venta"},
      management:{service:"Administración de propiedades",fee:"10% mensual",includes:["Cobranza y liquidación al propietario","Seguimiento operativo del arrendamiento","Gestión de mantenimiento conforme al contrato"]},
      process:{steps:["Conocer inmueble y servicio requerido","Revisar ubicación, características y expectativa de precio/renta","Coordinar revisión del inmueble","Definir estrategia y condiciones antes de publicar"]}
    };
    return[{topic,...(info[topic]||info.general),source:"Emporio Inmobiliario · operación vigente"}];
  }
  if(name==="check_owner_coverage"){
    const raw=String(args?.location||"").trim();
    if(!raw)throw new Error("invalid_tool_arguments");
    const n=raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const covered=["puebla","cholula","san andres cholula","san pedro cholula","cuautlancingo","coronango","tlaxcalancingo","veracruz","boca del rio","riviera veracruzana","alvarado"].some(x=>n.includes(x));
    return[{location:raw,covered,coverage:covered?"Puebla y zona metropolitana; Veracruz puerto, Boca del Río, Riviera Veracruzana y Alvarado":"outside_current_coverage"}];
  }
  throw new Error("owner_tool_not_implemented");
}

export async function createOwnerSession({input,env=process.env}){
  assertOwnerAgentEnvironment(env);
  const response=await fetch("https://api.openai.com/v1/agents/sessions",{
    method:"POST",headers:headers(env),
    body:JSON.stringify({agent:ownerAgentConfig(env),environment:{type:"none"},input:String(input||"").slice(0,5000),stream:false,metadata:{system:"inmoadmin",mode:"owner_agent_v1"}})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body?.id)throw new Error("owner_agent_create_failed_"+response.status);
  return body;
}
export async function getOwnerSession(id,env=process.env){
  const r=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(id),{headers:headers(env)});
  const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error("owner_agent_retrieve_failed_"+r.status);return b;
}
export async function fulfillOwnerActions(session,env=process.env){
  const calls=(session?.required_actions||[]).filter(a=>a?.type==="function_call"&&OWNER_TOOLS.includes(a?.name));
  if(!calls.length)return 0;
  const events=[];
  for(const call of calls){
    try{events.push({type:"agent.session.input.tool_result",turn_id:call.turn_id,call_id:call.call_id,success:true,output:JSON.stringify(await executeOwnerTool(call.name,call.arguments||{}))});}
    catch(error){events.push({type:"agent.session.input.tool_result",turn_id:call.turn_id,call_id:call.call_id,success:false,error:String(error?.message||"tool_failed").slice(0,120)});}
  }
  const r=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(session.id)+"/events",{method:"POST",headers:headers(env),body:JSON.stringify({events})});
  if(!r.ok)throw new Error("owner_agent_tool_result_failed_"+r.status);
  return events.length;
}
export async function ownerOutput(sessionId,env=process.env){
  const r=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(sessionId)+"/items?order=asc&limit=100",{headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"OpenAI-Beta":"agents=v1"}});
  const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error("owner_agent_items_failed_"+r.status);
  const a=[...(b?.data||[])].reverse().find(x=>x?.role==="assistant");
  return(a?.content||[]).map(p=>p?.text||p?.output_text||"").filter(Boolean).join("\n").slice(0,3000);
}
