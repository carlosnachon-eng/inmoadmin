import {
  assertSalesAgentV2ShadowEnvironment,
  createSalesSession,
  fulfillSalesActions,
  getSalesSession,
  salesAssistantOutput,
  salesSessionItems,
} from "./openaiSalesAgent";
import { readRespondMessages, respondMessageTimestamp } from "../ejecutivo/respondSync";
import { sanitizeShadowText } from "../shadow/coordinator";

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export async function runSalesAgentV2ShadowMessage(admin,inbound,{env=process.env}={}){
  assertSalesAgentV2ShadowEnvironment(env);
  if(!inbound?.id||!inbound?.respond_contact_id||!inbound?.sanitized_text) throw new Error("sales_inbound_invalid");

  const {data:history,error:historyError}=await admin.from("sales_agent_v2_inbound_messages")
    .select("occurred_at,sanitized_text,status")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .lte("occurred_at",inbound.occurred_at)
    .order("occurred_at",{ascending:false})
    .limit(5);
  if(historyError) throw historyError;
  const localHistory=(history||[]).reverse()
    .map((row)=>"- prospecto: "+String(row.sanitized_text||"").slice(0,500))
    .join("\n");

  let respondHistory="";
  try{
    const respond=await readRespondMessages(inbound.respond_contact_id,1);
    respondHistory=(respond.messages||[])
      .map((message)=>{
        const timestamp=respondMessageTimestamp(message);
        const traffic=String(message?.traffic||message?.direction||"").toLowerCase();
        const role=["incoming","inbound"].includes(traffic)?"prospecto":["outgoing","outbound"].includes(traffic)?"Emporio":"desconocido";
        const raw=String(message?.text??message?.message?.text??message?.body??message?.message?.body??"").trim();
        const safe=sanitizeShadowText(raw);
        return !timestamp||safe.rejected?null:{timestamp,role,text:safe.text.slice(0,700)};
      })
      .filter(Boolean)
      .sort((a,b)=>a.timestamp.localeCompare(b.timestamp))
      .slice(-12)
      .map((row)=>"- "+row.role+": "+row.text)
      .join("\n");
  }catch(error){
    console.error("[sales-v2-context]",String(error?.message||"respond_history_failed").slice(0,120));
  }

  const input=[
    "respondContactId opaco: "+String(inbound.respond_contact_id).slice(0,120),
    "channelId comercial: "+String(inbound.channel_id).slice(0,80),
    "Historial reciente real de Respond (incluye prospecto y respuestas previas de Emporio):",
    respondHistory||"(no disponible)",
    "Historial capturado por Sales V2:",
    localHistory||"(sin historial local)",
    "Mensaje actual:",
    String(inbound.sanitized_text).slice(0,2000),
    "Modo Shadow: no envíes nada. Usa únicamente perfil comercial, cobertura e inventario verificado. Mantén continuidad con toda la conversación. Si el prospecto ya confirmó una cita, agradece y no reinicies la calificación. Si pide ver una propiedad o dice que está muy interesado, responde sobre ese contexto en vez de volver a preguntar desde cero.",
  ].join("\n");

  const started=Date.now();
  let session=await createSalesSession({input,env});
  const calledTools=[];
  for(let step=0;step<80;step+=1){
    session=await getSalesSession({sessionId:session.id,env});
    if(session.status==="requires_action"){
      for(const action of session.required_actions||[]) calledTools.push(String(action?.name||action?.type||"unknown").slice(0,80));
      const handled=await fulfillSalesActions({db:admin,session,env});
      if(!handled) throw new Error("sales_agent_v2_unhandled_required_action");
      await sleep(150);
      continue;
    }
    if(["idle","failed"].includes(session.status)) break;
    await sleep(350);
  }
  session=await getSalesSession({sessionId:session.id,env});
  const items=await salesSessionItems(session.id,env);
  return{
    ok:session.status==="idle",
    sessionId:session.id,
    status:session.status,
    calledTools,
    output:salesAssistantOutput(items),
    latencyMs:Date.now()-started,
    error:session.error||null,
  };
}
