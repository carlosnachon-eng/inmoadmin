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
import { readSocialSalesContext, socialSalesOutput } from "../social/salesInventory.js";
import { isShortSocialCta, SOCIAL_CTA_CLARIFICATION } from "../social/commercialIntent.js";

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export async function runSalesAgentV2ShadowMessage(admin,inbound,{env=process.env}={}){
  assertSalesAgentV2ShadowEnvironment(env);
  if(!inbound?.id||!inbound?.respond_contact_id||!inbound?.sanitized_text) throw new Error("sales_inbound_invalid");
  const socialContext=await readSocialSalesContext(admin,inbound,env);
  if(socialContext&&isShortSocialCta(inbound.sanitized_text)&&!socialContext.sourceProperty){
    // Existing run journal + existing sender, not another agent or handoff. No provider.
    return {ok:true,sessionId:"human-review-social-cta-"+inbound.id,status:"idle",calledTools:[],output:SOCIAL_CTA_CLARIFICATION,latencyMs:0,error:null,policyOnly:true};
  }

  const {data:profileSnapshot,error:profileSnapshotError}=await admin.from("gv_respond_contact_snapshots")
    .select("respond_contact_id,mapped_profile_id,mapping_status,respond_conversation_status,respond_lifecycle,atn_area,atn_servicio,atn_estado,atn_destino,atn_proxima_accion,atn_fecha_proxima_accion,ven_presupuesto_compra,ven_renta_mensual_objetivo,ven_plazo,inm_tipo,inm_zona,sales_relevant,respond_record_active,respond_blocked")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .maybeSingle();
  if(profileSnapshotError)throw profileSnapshotError;

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

  const profileContext=profileSnapshot?JSON.stringify({
    assignedProfileId:profileSnapshot.mapped_profile_id,
    mappingStatus:profileSnapshot.mapping_status,
    conversationStatus:profileSnapshot.respond_conversation_status,
    lifecycle:profileSnapshot.respond_lifecycle,
    area:profileSnapshot.atn_area,
    service:profileSnapshot.atn_servicio,
    state:profileSnapshot.atn_estado,
    destination:profileSnapshot.atn_destino,
    nextAction:profileSnapshot.atn_proxima_accion,
    nextActionDate:profileSnapshot.atn_fecha_proxima_accion,
    purchaseBudget:profileSnapshot.ven_presupuesto_compra,
    targetRent:profileSnapshot.ven_renta_mensual_objetivo,
    timeframe:profileSnapshot.ven_plazo,
    propertyType:profileSnapshot.inm_tipo,
    zone:profileSnapshot.inm_zona,
    salesRelevant:Boolean(profileSnapshot.sales_relevant),
    active:Boolean(profileSnapshot.respond_record_active),
    blocked:Boolean(profileSnapshot.respond_blocked),
  }):"(perfil no disponible)";

  const input=[
    ...(socialContext ? ["Origen social verificado por Inmoadmin (no inferir propiedad desde keyword/post/campaign):",JSON.stringify(socialContext.sourceProperty),"Búsqueda textual no confirma publicación origen. Si falta certeza, pide enlace/ubicación; nunca deduzcas ausencia de inventario de una búsqueda vacía."] : []),
    "respondContactId opaco: "+String(inbound.respond_contact_id).slice(0,120),
    "channelId comercial: "+String(inbound.channel_id).slice(0,80),
    "Perfil comercial ya resuelto por Inmoadmin (no vuelvas a consultar get_sales_contact_profile salvo que falte o sea insuficiente):",
    profileContext,
    "Historial reciente real de Respond (incluye prospecto y respuestas previas de Emporio):",
    respondHistory||localHistory||"(no disponible)",
    "Mensaje actual:",
    String(inbound.sanitized_text).slice(0,2000),
    "Modo Shadow: no envíes nada. Usa únicamente perfil comercial, cobertura e inventario verificado. Mantén continuidad con toda la conversación. Si el prospecto ya confirmó una cita, agradece y no reinicies la calificación. Si pide ver una propiedad o dice que está muy interesado, responde sobre ese contexto en vez de volver a preguntar desde cero.",
  ].join("\n");

  const started=Date.now();
  let session=await createSalesSession({input,env});
  const calledTools=[];
  const seenToolCalls=new Set();
  for(let step=0;step<80;step+=1){
    session=await getSalesSession({sessionId:session.id,env});
    if(session.status==="requires_action"){
      for(const action of session.required_actions||[]) calledTools.push(String(action?.name||action?.type||"unknown").slice(0,80));
      const handled=await fulfillSalesActions({db:admin,session,env,seenToolCalls,socialContext});
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
    output:socialSalesOutput(salesAssistantOutput(items),socialContext),
    latencyMs:Date.now()-started,
    error:session.error||null,
  };
}
