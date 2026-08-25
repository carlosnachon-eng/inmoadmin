import { DEFAULT_SHADOW_AI_MODEL, sanitizeAnthropicError } from "../ai/anthropic.js";

export const SHADOW_MEDIA_INTERPRETATION_RUNTIME = "shadow-media-vision-v1";
export const SHADOW_MEDIA_INTERPRETATION_CATEGORIES = Object.freeze([
  "possible_payment_receipt", "possible_maintenance_damage", "document_or_screenshot",
  "property_photo", "other_image", "insufficient_visual_evidence",
]);
export const SHADOW_MEDIA_VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const CATEGORY_SET = new Set(SHADOW_MEDIA_INTERPRETATION_CATEGORIES);
const ISSUE_SET = new Set(["humidity","seepage","crack","damaged_paint","apparent_damage","visible_installation","other_deterioration"]);
const FORBIDDEN_PAYMENT = /\b(payment[_ -]?(?:confirmed|valid)|authentic[_ -]?receipt|pago\s+(?:confirmado|validado)|comprobante\s+(?:aut[eé]ntico|v[aá]lido))\b/i;
const DEFINITIVE_DAMAGE = /\b(?:diagn[oó]stico\s+(?:definitivo|confirmado)|causa\s+(?:estructural|confirmada)|daño\s+estructural\s+confirmado)\b/i;
const TOP_KEYS=new Set(["media_type","interpretation_status","category","summary","extracted_fields","confidence","requires_human_review","review_reason"]);
const FIELD_KEYS=new Set(["amount","currency","date","sender_bank","recipient_bank","reference","account_last4","observable_issues"]);
const cleanCode = (value, fallback="media_interpretation_error") => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,80) || fallback;
const finite = (value) => value===null||value===undefined||value===""?null:(Number.isFinite(Number(value)) ? Number(value) : null);
const nullableString = (value) => value == null ? null : String(value);

export function sanitizeMediaInterpretationText(value, max=240) {
  let text=String(value ?? "").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim();
  text=text.replace(/https?:\/\/\S+/gi,"[OMITIDO]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,"[EMAIL]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g,(match)=>{const digits=match.replace(/\D/g,"");return match.trim().startsWith("+")?"[TELEFONO]":(digits.length>=12?`[CUENTA ****${digits.slice(-4)}]`:"[TELEFONO]");})
    .replace(/\b(?:CLABE|cuenta|tarjeta)\s*[:#-]?\s*\d{5,}\b/gi,(match)=>`[CUENTA ****${match.replace(/\D/g,"").slice(-4)}]`)
    .replace(/\b(?:firma|firmado por|rostro de|identificaci[oó]n oficial|INE|pasaporte)\b[^.;]{0,100}/gi,"[OMITIDO]")
    .replace(/\b(?:QR|c[oó]digo de barras)\s*[:#-]?\s*\S+/gi,"[OMITIDO]")
    .replace(/\b(?:domicilio|calle|avenida|av\.)\s*[:#-]?\s*[^.;]{4,120}/gi,"[DOMICILIO OMITIDO]");
  return text.slice(0,max);
}

const mediaInterpretationSchema = {
  type:"object",additionalProperties:false,
  required:["media_type","interpretation_status","category","summary","extracted_fields","confidence","requires_human_review","review_reason"],
  properties:{
    media_type:{type:"string",enum:["image"]}, interpretation_status:{type:"string",enum:["completed"]},
    category:{type:"string",enum:SHADOW_MEDIA_INTERPRETATION_CATEGORIES}, summary:{type:"string"},
    extracted_fields:{type:"object",additionalProperties:false,required:["amount","currency","date","sender_bank","recipient_bank","reference","account_last4","observable_issues"],properties:{
      amount:{type:["number","null"]},currency:{type:["string","null"]},date:{type:["string","null"]},sender_bank:{type:["string","null"]},recipient_bank:{type:["string","null"]},reference:{type:["string","null"]},account_last4:{type:["string","null"]},observable_issues:{type:"array",items:{type:"string",enum:[...ISSUE_SET]}},
    }},
    confidence:{type:"number"},requires_human_review:{type:"boolean"},review_reason:{type:["string","null"]},
  },
};

export function validateAndSanitizeMediaInterpretation(value,{model=DEFAULT_SHADOW_AI_MODEL,now=new Date()}={}) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Object.assign(new Error("invalid_shape"),{code:"invalid_shape"});
  if(Object.keys(value).some((key)=>!TOP_KEYS.has(key))||value.media_type!=="image"||value.interpretation_status!=="completed"||typeof value.summary!=="string"||!value.summary.trim()||typeof value.extracted_fields!=="object"||value.extracted_fields===null||Array.isArray(value.extracted_fields)||typeof value.requires_human_review!=="boolean"||!(value.review_reason==null||typeof value.review_reason==="string"))throw Object.assign(new Error("invalid_shape"),{code:"invalid_shape"});
  if(!CATEGORY_SET.has(value.category))throw Object.assign(new Error("invalid_category"),{code:"invalid_category"});
  const joined=JSON.stringify(value);
  if(FORBIDDEN_PAYMENT.test(joined))throw Object.assign(new Error("forbidden_payment_semantics"),{code:"forbidden_payment_semantics"});
  if(DEFINITIVE_DAMAGE.test(joined))throw Object.assign(new Error("forbidden_diagnostic_semantics"),{code:"forbidden_diagnostic_semantics"});
  const fields=value.extracted_fields;
  if(Object.keys(fields).some((key)=>!FIELD_KEYS.has(key))||["currency","date","sender_bank","recipient_bank","reference","account_last4"].some((key)=>!(fields[key]==null||typeof fields[key]==="string")))throw Object.assign(new Error("invalid_extracted_field"),{code:"invalid_extracted_field"});
  const issues=Array.isArray(fields.observable_issues)?fields.observable_issues:[];
  if(!Array.isArray(fields.observable_issues)||issues.length>8||issues.some((item)=>!ISSUE_SET.has(item)))throw Object.assign(new Error("invalid_extracted_field"),{code:"invalid_extracted_field"});
  const accountLast4=fields.account_last4==null?null:String(fields.account_last4).replace(/\D/g,"");
  if(accountLast4!==null&&accountLast4.length!==4)throw Object.assign(new Error("invalid_account_last4"),{code:"invalid_account_last4"});
  if(typeof value.confidence!=="number")throw Object.assign(new Error("invalid_confidence"),{code:"invalid_confidence"});
  const confidence=finite(value.confidence);
  if(confidence===null||confidence<0||confidence>1)throw Object.assign(new Error("invalid_confidence"),{code:"invalid_confidence"});
  if(fields.amount!==null&&typeof fields.amount!=="number")throw Object.assign(new Error("invalid_amount"),{code:"invalid_amount"});
  const amount=finite(fields.amount);if(amount!==null&&(amount<0||amount>1_000_000_000))throw Object.assign(new Error("invalid_amount"),{code:"invalid_amount"});
  const financial=value.category==="possible_payment_receipt";
  const uncertain=value.category==="insufficient_visual_evidence";
  return {
    media_type:"image",interpretation_status:"completed",category:value.category,
    summary:sanitizeMediaInterpretationText(value.summary,240),
    extracted_fields:{
      amount,currency:sanitizeMediaInterpretationText(nullableString(fields.currency),12)||null,date:sanitizeMediaInterpretationText(nullableString(fields.date),20)||null,
      sender_bank:sanitizeMediaInterpretationText(nullableString(fields.sender_bank),60)||null,recipient_bank:sanitizeMediaInterpretationText(nullableString(fields.recipient_bank),60)||null,
      reference:sanitizeMediaInterpretationText(nullableString(fields.reference),80)||null,account_last4:accountLast4,observable_issues:[...new Set(issues)].slice(0,8),
    },
    confidence,requires_human_review:financial||uncertain||value.requires_human_review===true,
    review_reason:sanitizeMediaInterpretationText(value.review_reason,160)||((financial||uncertain)?"Requiere revisión humana.":null),
    runtime_version:SHADOW_MEDIA_INTERPRETATION_RUNTIME,model:String(model).slice(0,120),interpreted_at:new Date(now).toISOString(),
  };
}

export function mediaInterpretationEnabled(env=process.env){return env.SHADOW_MEDIA_INTERPRETATION_ENABLED==="true"&&env.SHADOW_MEDIA_RETRIEVAL_ENABLED==="true"&&env.SHADOW_OUTBOUND_ENABLED!=="true";}

export async function createAnthropicMediaInterpretation({buffer,mimeType,contextText=""},{env=process.env,fetchImpl=fetch,signal}={}){
  if(!SHADOW_MEDIA_VISION_MIME.has(mimeType))throw Object.assign(new Error("unsupported_media_interpretation"),{code:"unsupported_media_interpretation"});
  if(!env.ANTHROPIC_API_KEY)throw Object.assign(new Error("anthropic_key_missing"),{code:"anthropic_key_missing"});
  const response=await fetchImpl("https://api.anthropic.com/v1/messages",{method:"POST",signal,headers:{"x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({
    model:env.SHADOW_AI_MODEL||DEFAULT_SHADOW_AI_MODEL,max_tokens:Number(env.SHADOW_MEDIA_INTERPRETATION_MAX_TOKENS||700),
    system:"Modo Shadow visual read-only. Clasifica evidencia aparente, nunca confirmes pagos, autenticidad, causas técnicas ni acciones. No identifiques personas. Devuelve sólo el schema.",
    messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mimeType,data:buffer.toString("base64")}},{type:"text",text:`Contexto mínimo sanitizado: ${sanitizeMediaInterpretationText(contextText,600)||"sin contexto"}`}]}],
    output_config:{format:{type:"json_schema",schema:mediaInterpretationSchema}},
  })});
  if(!response.ok){let body=null;try{body=await response.json();}catch{}const error=Object.assign(new Error("media_model_provider_error"),{code:"media_model_provider_error",providerError:sanitizeAnthropicError(response,body)});throw error;}
  const json=await response.json();
  return{id:json.id||null,text:(json.content||[]).find((block)=>block.type==="text")?.text||null,usage:json.usage||{},model:json.model||env.SHADOW_AI_MODEL||DEFAULT_SHADOW_AI_MODEL};
}

const costUsd=(input,output)=>(Number(input||0)+Number(output||0)*5)/1_000_000;
export async function interpretValidatedShadowImage(admin,{claim,buffer,validated,env=process.env,modelCall=createAnthropicMediaInterpretation,now=new Date()}={}){
  if(!mediaInterpretationEnabled(env))return{status:"off"};
  if(claim.channel_id!=="544519"||claim.channel_source!=="whatsapp_business"||claim.provider!=="respond_admin"||!SHADOW_MEDIA_VISION_MIME.has(validated.validatedMime))return{status:"skipped"};
  const runtime=SHADOW_MEDIA_INTERPRETATION_RUNTIME,model=env.SHADOW_AI_MODEL||DEFAULT_SHADOW_AI_MODEL;
  const base={queue_id:claim.id,provider:claim.provider,external_message_id:claim.external_message_id,content_hash:validated.sha256,runtime_version:runtime,model,status:"processing",media_type:"image"};
  const {data:created,error:insertError}=await admin.from("shadow_media_interpretations").insert(base).select("id,status").single();
  if(insertError?.code==="23505")return{status:"duplicate"};
  if(insertError)throw insertError;
  const started=Date.now();let timer;const controller=new AbortController();
  try{
    const {data:message}=await admin.from("shadow_messages").select("sanitized_text").eq("provider",claim.provider).eq("external_message_id",claim.external_message_id).limit(1).maybeSingle();
    timer=setTimeout(()=>controller.abort(),Math.min(90_000,Number(env.SHADOW_MEDIA_INTERPRETATION_TIMEOUT_MS)||90_000));
    const response=await modelCall({buffer,mimeType:validated.validatedMime,contextText:message?.sanitized_text||""},{env,signal:controller.signal});
    let parsed;try{parsed=JSON.parse(response.text);}catch{throw Object.assign(new Error("invalid_json"),{code:"invalid_json"});}
    const result=validateAndSanitizeMediaInterpretation(parsed,{model:response.model,now});
    const inputTokens=Number(response.usage?.input_tokens||0),outputTokens=Number(response.usage?.output_tokens||0),latencyMs=Date.now()-started;
    const {error}=await admin.from("shadow_media_interpretations").update({status:"completed",result_safe:result,provider_request_id:String(response.id||"").slice(0,120)||null,input_tokens:inputTokens,output_tokens:outputTokens,estimated_cost_usd:costUsd(inputTokens,outputTokens),latency_ms:latencyMs,interpreted_at:result.interpreted_at,error_code:null}).eq("id",created.id).eq("status","processing");if(error)throw error;
    return{status:"completed",id:created.id,result};
  }catch(error){
    const code=cleanCode(error?.name==="AbortError"?"anthropic_timeout":error?.code);
    await admin.from("shadow_media_interpretations").update({status:"failed",error_code:code,provider_request_id:String(error?.providerError?.provider_request_id||"").slice(0,120)||null,latency_ms:Date.now()-started,interpreted_at:new Date().toISOString()}).eq("id",created.id).eq("status","processing");
    return{status:"failed",id:created.id,error:code};
  }finally{clearTimeout(timer);}
}
