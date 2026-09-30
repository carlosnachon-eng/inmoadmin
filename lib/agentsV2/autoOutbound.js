import { executeShadowReadOnlyTool } from "../shadow/context.js";

export const ADMIN_AGENT_V2_AUTO_OUTBOUND_CHANNEL_ID = "544519";
const CONTRACT_END_RE = /\b(cu[aá]ndo|qu[eé]\s+fecha|fecha|d[ií]a).{0,45}(termina|vence|vencimiento).{0,25}(contrato|arrendamiento)|\b(termina|vence|vencimiento).{0,35}(contrato|arrendamiento)|\b(contrato|arrendamiento).{0,35}(termina|vence|vencimiento)\b/i;
const RISKY_RE = /\b(cancelar|cancelaci[oó]n|terminaci[oó]n\s+anticipada|salirme|rescisi[oó]n|demanda|abogado|jur[ií]dico|dep[oó]sito|penalizaci[oó]n|incumplimiento|renovar|renovaci[oó]n|aumento|negociar|queja|profeco)\b/i;

const clean=(value,max=480)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);

export function assertAdminAgentV2AutoOutboundEnvironment(env=process.env){
  if(env.ADMIN_AGENT_V2_AUTO_OUTBOUND_ENABLED!=="true") throw Object.assign(new Error("v2_auto_outbound_disabled"),{statusCode:409});
  if(env.VERCEL_ENV!=="production"||env.SUPABASE_ENVIRONMENT!=="production") throw Object.assign(new Error("v2_auto_outbound_environment_mismatch"),{statusCode:409});
  if(env.SHADOW_OUTBOUND_ENABLED==="true"||env.SHADOW_ADMIN_OUTBOUND_ENABLED==="true") throw Object.assign(new Error("legacy_outbound_must_remain_disabled"),{statusCode:409});
  if(!env.RESPOND_IO_TOKEN&&!env.RESPOND_IO_API_TOKEN) throw Object.assign(new Error("respond_sender_credential_missing"),{statusCode:503});
  const raw=String(env.ADMIN_AGENT_V2_AUTO_OUTBOUND_NOT_BEFORE||"").trim();
  const ms=Date.parse(raw);
  if(!Number.isFinite(ms)) throw Object.assign(new Error("v2_auto_outbound_cutoff_invalid"),{statusCode:409});
  return{notBefore:new Date(ms).toISOString(),channelId:ADMIN_AGENT_V2_AUTO_OUTBOUND_CHANNEL_ID};
}

export function isSafeContractEndDateMessage(text){
  const value=clean(text,1000);
  return Boolean(value && CONTRACT_END_RE.test(value) && !RISKY_RE.test(value));
}

function formatSpanishDate(iso){
  const match=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return null;
  const months=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
  if(!y||m<1||m>12||d<1||d>31)return null;
  return \`\${d} de \${months[m-1]} de \${y}\`;
}

async function sendRespondText(contactId,text,env){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(\`https://api.respond.io/v2/contact/id:\${encodeURIComponent(String(contactId))}/message\`,{
      method:"POST",
      headers:{
        Authorization:\`Bearer \${env.RESPOND_IO_TOKEN||env.RESPOND_IO_API_TOKEN}\`,
        Accept:"application/json",
        "Content-Type":"application/json",
      },
      body:JSON.stringify({channelId:Number(ADMIN_AGENT_V2_AUTO_OUTBOUND_CHANNEL_ID),message:{type:"text",text:clean(text)}}),
      signal:controller.signal,
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(response.status>=500||response.status===429?"respond_delivery_unknown":"respond_rejected");
    if(!body?.messageId)throw new Error("respond_delivery_unknown");
    return String(body.messageId).slice(0,120);
  }catch(error){
    if(error?.name==="AbortError")throw new Error("respond_delivery_unknown");
    throw error;
  }finally{clearTimeout(timeout);}
}

async function findCandidate(admin,notBefore){
  const {data,error}=await admin
    .from("shadow_messages")
    .select("id,conversation_id,sanitized_text,occurred_at,attachment_metadata")
    .eq("provider","respond_admin")
    .eq("direction","inbound")
    .gte("occurred_at",notBefore)
    .order("occurred_at",{ascending:true})
    .limit(100);
  if(error)throw error;
  for(const message of data||[]){
    if((message.attachment_metadata||[]).length)continue;
    if(!isSafeContractEndDateMessage(message.sanitized_text))continue;
    const [{data:run,error:runError},{data:existing,error:existingError}]=await Promise.all([
      admin.from("admin_agent_v2_shadow_runs").select("id,status,called_tools").eq("message_id",message.id).eq("status","idle").maybeSingle(),
      admin.from("admin_agent_v2_auto_outbound").select("id").eq("message_id",message.id).maybeSingle(),
    ]);
    if(runError||existingError)throw runError||existingError;
    if(!run||existing)continue;
    if(!Array.isArray(run.called_tools)||!run.called_tools.includes("resolve_contact_identity"))continue;
    return message;
  }
  return null;
}

export async function processOneAdminAgentV2AutoOutbound(admin,{env=process.env}={}){
  const capability=assertAdminAgentV2AutoOutboundEnvironment(env);
  const message=await findCandidate(admin,capability.notBefore);
  if(!message)return{status:"no_work"};

  const {data:conversation,error:conversationError}=await admin.from("shadow_conversations")
    .select("id,channel,respond_contact_id")
    .eq("id",message.conversation_id).maybeSingle();
  if(conversationError)throw conversationError;
  if(!conversation||conversation.channel!==capability.channelId||!conversation.respond_contact_id)return{status:"no_work"};

  const {data:claim,error:claimError}=await admin.from("admin_agent_v2_auto_outbound").insert({
    message_id:message.id,
    conversation_id:conversation.id,
    respond_contact_id:conversation.respond_contact_id,
    case_kind:"contract_end_date",
    status:"processing",
  }).select("id").single();
  if(claimError?.code==="23505")return{status:"no_work"};
  if(claimError)throw claimError;

  const block=async(reason)=>{
    await admin.from("admin_agent_v2_auto_outbound").update({status:"blocked",error_code:reason,completed_at:new Date().toISOString()}).eq("id",claim.id);
    return{id:claim.id,status:"blocked",reason};
  };

  try{
    const identityRows=await executeShadowReadOnlyTool(admin,"resolve_contact_identity",{respondContactId:conversation.respond_contact_id});
    const identity=identityRows.find((row)=>row.entityType==="contact_identity");
    if(!identity?.resolved||identity.status!=="confirmed")return block("identity_not_confirmed");

    const activeContracts=identityRows.filter((row)=>row.entityType==="contract"&&row.active===true);
    if(activeContracts.length!==1)return block(activeContracts.length?"multiple_active_contracts":"no_active_contract");

    const contractRows=await executeShadowReadOnlyTool(admin,"find_active_contracts",{contractId:activeContracts[0].internalId});
    if(contractRows.length!==1||!contractRows[0]?.endDate)return block("contract_end_date_not_deterministic");
    const dateText=formatSpanishDate(contractRows[0].endDate);
    if(!dateText)return block("contract_end_date_invalid");

    const {data:newer,error:newerError}=await admin.from("shadow_messages")
      .select("id,direction,occurred_at")
      .eq("conversation_id",conversation.id)
      .gt("occurred_at",message.occurred_at)
      .order("occurred_at",{ascending:true})
      .limit(1);
    if(newerError)throw newerError;
    if((newer||[]).length){
      await admin.from("admin_agent_v2_auto_outbound").update({status:"superseded",error_code:"newer_message_exists",completed_at:new Date().toISOString()}).eq("id",claim.id);
      return{id:claim.id,status:"superseded"};
    }

    const responseText=\`Tu contrato vigente termina el \${dateText}. Si quieres, también puedo ayudarte a revisar qué sigue para la renovación o entrega del inmueble.\`;
    await admin.from("admin_agent_v2_auto_outbound").update({proposed_message:responseText}).eq("id",claim.id);
    const providerMessageId=await sendRespondText(conversation.respond_contact_id,responseText,env);
    const sentAt=new Date().toISOString();
    await admin.from("admin_agent_v2_auto_outbound").update({
      status:"sent",provider_message_id:providerMessageId,sent_at:sentAt,completed_at:sentAt,
    }).eq("id",claim.id);
    return{id:claim.id,status:"sent",messageId:message.id,providerMessageId};
  }catch(error){
    const code=String(error?.message||"v2_auto_outbound_failed").slice(0,120);
    await admin.from("admin_agent_v2_auto_outbound").update({status:"failed",error_code:code,completed_at:new Date().toISOString()}).eq("id",claim.id);
    return{id:claim.id,status:"failed",error:code};
  }
}
