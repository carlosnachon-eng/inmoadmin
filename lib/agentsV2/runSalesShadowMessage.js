import {
  assertSalesAgentV2ShadowEnvironment,
  createSalesSession,
  fulfillSalesActions,
  getSalesSession,
  salesAssistantOutput,
  salesSessionItems,
} from "./openaiSalesAgent";

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export async function runSalesAgentV2ShadowMessage(admin,inbound,{env=process.env}={}){
  assertSalesAgentV2ShadowEnvironment(env);
  if(!inbound?.id||!inbound?.respond_contact_id||!inbound?.sanitized_text) throw new Error("sales_inbound_invalid");

  const input=[
    "respondContactId opaco: "+String(inbound.respond_contact_id).slice(0,120),
    "channelId comercial: "+String(inbound.channel_id).slice(0,80),
    "Mensaje real sanitizado del prospecto:",
    String(inbound.sanitized_text).slice(0,2000),
    "Modo Shadow: no envíes nada. Usa únicamente perfil comercial e inventario verificado. Si faltan datos, formula la mejor siguiente pregunta.",
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
