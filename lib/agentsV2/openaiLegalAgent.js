const TOOLS=["get_legal_policy_info"];
const schema={type:"object",additionalProperties:false,properties:{topic:{type:"string",enum:["coverage","pricing","documents","investigation","general"]},monthlyRent:{type:"number",minimum:0}}};
const headers=(env)=>({Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json","OpenAI-Beta":"agents=v1"});
const model=(env)=>env.OPENAI_LEGAL_AGENT_MODEL||env.OPENAI_SALES_AGENT_MODEL||env.OPENAI_ADMIN_AGENT_MODEL;

export function legalAgentConfig(env=process.env){
  return{
    model:model(env),
    instructions:[
      "Eres Jurídico IA de Emporio Blindaje Legal.",
      "Atiende preguntas generales sobre póliza jurídica, investigación, documentos, costos, vigencia, contrato y pagarés.",
      "Consulta get_legal_policy_info antes de dar precios, cobertura o requisitos.",
      "Nunca apruebes o rechaces personas, interpretes un dictamen concreto, autorices excepciones, sustituyas al área jurídica ni prometas resultado.",
      "Si preguntan por un expediente concreto, rechazo, excepción, demanda, negociación contractual o conflicto, explica que requiere revisión humana de Jurídico.",
      "No compartas cuentas bancarias ni instrucciones de pago salvo flujo oficial validado.",
      "Responde en español mexicano, breve, claro, sin Markdown y sólo con texto listo para enviar."
    ].join("\n"),
    tools:[{type:"function",name:"get_legal_policy_info",description:"Read Emporio Blindaje Legal's current general policy coverage, pricing and document/process information.",parameters:schema}]
  };
}
export async function legalTool(args){
  const topic=String(args?.topic||"general"),rent=Number(args?.monthlyRent||0);
  const price=rent>0?(rent<=7000?2800:rent<=10000?3200:rent<=15000?3800:rent<=20000?4500:rent<=25000?5200:rent<=30000?6100:rent<=40000?9500:rent<=50000?12500:Math.round(rent*.25)):null;
  return[{
    topic,
    includes:["Investigación completa del candidato","Dictamen formal","Contrato de arrendamiento","Póliza jurídica con vigencia de 12 meses","Cobranza extrajudicial","Recuperación judicial si aplica","Protección ante extinción de dominio","Atención jurídica durante la vigencia"],
    baseDocuments:["INE vigente","Comprobantes de ingresos de los últimos 3 meses","Solicitud de arrendamiento completa"],
    investigation:["Ingresos","Referencias personales, laborales y familiares","Buró México","Validación de documentos"],
    pricing:price?{monthlyRent:rent,policyPrice:price,iva:"más IVA",validity:"12 meses"}:"Cotización según renta mensual",
    paymentRule:"Generalmente la paga el inquilino y se cubre antes de la firma.",
    source:"Emporio Blindaje Legal · guía operativa vigente"
  }];
}
export async function createLegalSession(input,env=process.env){
  if(!env.OPENAI_API_KEY||!model(env))throw new Error("legal_agent_configuration_missing");
  const r=await fetch("https://api.openai.com/v1/agents/sessions",{method:"POST",headers:headers(env),body:JSON.stringify({agent:legalAgentConfig(env),environment:{type:"none"},input:String(input||"").slice(0,5000),stream:false,metadata:{system:"inmoadmin",mode:"legal_agent_v1"}})});
  const b=await r.json().catch(()=>({}));if(!r.ok||!b?.id)throw new Error("legal_agent_create_failed_"+r.status);return b;
}
export async function getLegalSession(id,env=process.env){const r=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(id),{headers:headers(env)});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error("legal_agent_retrieve_failed_"+r.status);return b;}
export async function fulfillLegal(session,env=process.env){
  const calls=(session?.required_actions||[]).filter(a=>a?.type==="function_call"&&TOOLS.includes(a?.name));if(!calls.length)return 0;
  const events=[];for(const call of calls){events.push({type:"agent.session.input.tool_result",turn_id:call.turn_id,call_id:call.call_id,success:true,output:JSON.stringify(await legalTool(call.arguments||{}))});}
  const r=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(session.id)+"/events",{method:"POST",headers:headers(env),body:JSON.stringify({events})});if(!r.ok)throw new Error("legal_agent_tool_result_failed_"+r.status);return events.length;
}
export async function legalOutput(id,env=process.env){const r=await fetch("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(id)+"/items?order=asc&limit=100",{headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"OpenAI-Beta":"agents=v1"}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error("legal_agent_items_failed_"+r.status);const a=[...(b?.data||[])].reverse().find(x=>x?.role==="assistant");return(a?.content||[]).map(p=>p?.text||p?.output_text||"").filter(Boolean).join("\n").slice(0,3000);}
