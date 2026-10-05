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
import { SOCIAL_CTA_CLARIFICATION } from "../social/commercialIntent.js";
import { readSalesConversation, isolatedSalesCta, salesClarificationPolicy, hasSalesProfileContext } from "./salesConversation.js";
import { anchorHistoricalText } from "../social/continuity.js";
import { classifySalesHandoff } from "./salesHandoff.js";
import { readHumanAttention, pausedSalesResult } from "./humanAttention.js";

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export async function runSalesAgentV2ShadowMessage(admin,inbound,{env=process.env}={}){
  assertSalesAgentV2ShadowEnvironment(env);
  if(!inbound?.id||!inbound?.respond_contact_id||!inbound?.sanitized_text) throw new Error("sales_inbound_invalid");
  const human = await readHumanAttention(admin,inbound);
  if(human.blocked)return pausedSalesResult(human,inbound.id);
  const socialContext=await readSocialSalesContext(admin,inbound,env);
  const conversation=socialContext?await readSalesConversation(admin,inbound):null;
  if(socialContext) Object.assign(socialContext,{messageText:conversation.burstText,hasConversationContext:conversation.hasContext});

  const {data:profileSnapshot,error:profileSnapshotError}=await admin.from("gv_respond_contact_snapshots")
    .select("respond_contact_id,mapped_profile_id,mapping_status,respond_conversation_status,respond_lifecycle,atn_area,atn_servicio,atn_estado,atn_destino,atn_proxima_accion,atn_fecha_proxima_accion,ven_presupuesto_compra,ven_renta_mensual_objetivo,ven_plazo,inm_tipo,inm_zona,sales_relevant,respond_record_active,respond_blocked")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .maybeSingle();
  if(profileSnapshotError)throw profileSnapshotError;

  if(conversation&&classifySalesHandoff(conversation.burstText,{strict:true})?.reason==="human_requested"){
    return {ok:true,sessionId:"human-review-social-request-"+inbound.id,status:"idle",calledTools:[],output:"Solicitud de atención humana registrada para revisión.",latencyMs:0,error:null,policyOnly:true};
  }

  if(socialContext&&isolatedSalesCta(inbound.sanitized_text,{
    ...conversation,hasContext:conversation.hasContext||hasSalesProfileContext(profileSnapshot),
  },socialContext.sourceProperty)&&!conversation.linkSeen){
    return {ok:true,sessionId:"human-review-social-cta-"+inbound.id,status:"idle",calledTools:[],output:SOCIAL_CTA_CLARIFICATION,latencyMs:0,error:null,policyOnly:true};
  }

  const {data:history,error:historyError}=await admin.from("sales_agent_v2_inbound_messages")
    .select("occurred_at,sanitized_text,status")
    .eq("respond_contact_id",inbound.respond_contact_id)
    .eq("channel_id",inbound.channel_id)
    .lte("occurred_at",inbound.occurred_at)
    .order("occurred_at",{ascending:false})
    .limit(5);
  if(historyError) throw historyError;
  const localHistory=(conversation?.history||(history||[]).reverse())
    .map((row)=>"- prospecto: "+anchorHistoricalText(String(row.sanitized_text||"").slice(0,500),row.occurred_at))
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
      .filter(row=>row&&row.timestamp<=inbound.occurred_at)
      .sort((a,b)=>a.timestamp.localeCompare(b.timestamp))
      .slice(-12)
      .map((row)=>"- "+row.role+": "+anchorHistoricalText(row.text,row.timestamp))
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
    ...(socialContext ? ["Origen social verificado por Inmoadmin (no inferir propiedad desde keyword/post/campaign):",JSON.stringify(socialContext.sourceProperty),"Búsqueda textual no confirma publicación origen. Nunca deduzcas ausencia de inventario de una búsqueda vacía. No vuelvas a pedir un enlace ya recibido: solicita nombre del edificio o colonia una sola vez. Renta, zona, edificio o Plis pueden responder a preguntas anteriores; no reinicies la calificación."] : []),
    "respondContactId opaco: "+String(inbound.respond_contact_id).slice(0,120),
    "channelId comercial: "+String(inbound.channel_id).slice(0,80),
    "Perfil comercial ya resuelto por Inmoadmin (no vuelvas a consultar get_sales_contact_profile salvo que falte o sea insuficiente):",
    profileContext,
    "Historial reciente real de Respond (incluye prospecto y respuestas previas de Emporio):",
    respondHistory||"(no disponible)",
    "Historial local capturado, incluidos fragmentos absorbidos (no omitirlo si Respond está atrasado):",
    localHistory||"(no disponible)",
    ...(conversation ? ["Últimas respuestas efectivamente enviadas (no propuestas):",conversation.sent.slice(0,5).reverse().map(row=>anchorHistoricalText(row.proposed_message,row.sent_at)).join("\n"),"Ráfaga actual completa:",conversation.burstText] : []),
    "Mensaje actual:",
    String(inbound.sanitized_text).slice(0,2000),
    "Modo Shadow: no envíes nada. Usa únicamente perfil comercial, cobertura e inventario verificado. Mantén continuidad con toda la conversación. Si el prospecto ya confirmó una cita, agradece y no reinicies la calificación. Si pide ver una propiedad o dice que está muy interesado, responde sobre ese contexto en vez de volver a preguntar desde cero.",
  ].join("\n");

  const started=Date.now();
  const finalHuman = await readHumanAttention(admin,inbound);
  if(finalHuman.blocked)return pausedSalesResult(finalHuman,inbound.id);
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
  const output=socialSalesOutput(salesAssistantOutput(items),socialContext);
  const checked=conversation?salesClarificationPolicy(output,conversation,socialContext.sourceProperty):{output};
  return{
    ok:session.status==="idle",
    sessionId:session.id,
    status:session.status,
    calledTools,
    output:checked.output,
    reviewReason:checked.reviewReason||null,
    latencyMs:Date.now()-started,
    error:session.error||null,
  };
}
