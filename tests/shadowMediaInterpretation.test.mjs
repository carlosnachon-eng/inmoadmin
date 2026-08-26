import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SHADOW_MEDIA_INTERPRETATION_CATEGORIES, SHADOW_MEDIA_INTERPRETATION_RUNTIME,
  createAnthropicMediaInterpretation, interpretValidatedShadowImage, mediaInterpretationEnabled,
  sanitizeMediaInterpretationText, validateAndSanitizeMediaInterpretation,
} from "../lib/shadow/media/interpretation.js";
import { buildRealShadowConversationTurns, realShadowTurnEnvelope } from "../lib/shadow/ai/conversationTurns.js";
import { createShadowAiInputSnapshot } from "../lib/shadow/ai/stateMachine.js";

const baseOutput=(overrides={})=>({media_type:"image",interpretation_status:"completed",category:"other_image",summary:"Imagen genérica sin datos verificables.",extracted_fields:{amount:null,currency:null,date:null,sender_bank:null,recipient_bank:null,reference:null,account_last4:null,observable_issues:[]},confidence:.7,requires_human_review:false,review_reason:null,...overrides});
const modelResult=(output=baseOutput())=>({id:"req_safe",text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:20},model:"claude-haiku-4-5-20251001"});
const claim={id:"00000000-0000-4000-8000-000000000010",provider:"respond_admin",external_message_id:"message-safe",channel_id:"544519",channel_source:"whatsapp_business"};
const validated={validatedMime:"image/jpeg",validatedSize:10,sha256:"a".repeat(64),pages:null};
const enabled={SHADOW_MEDIA_INTERPRETATION_ENABLED:"true",SHADOW_MEDIA_RETRIEVAL_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"false",ANTHROPIC_API_KEY:"test-only"};

function fakeDb({duplicate=false,message="Te mando esto"}={}){
  const writes=[];
  return{writes,from(table){return{
    insert(payload){writes.push({table,op:"insert",payload});return{select(){return{single:async()=>duplicate?{data:null,error:{code:"23505"}}:{data:{id:"00000000-0000-4000-8000-000000000011",status:"processing"},error:null}}}}},
    select(){const chain={eq(){return chain},limit(){return chain},maybeSingle:async()=>({data:{sanitized_text:message},error:null})};return chain},
    update(payload){writes.push({table,op:"update",payload});const chain={eq(){return chain},then(resolve){resolve({data:null,error:null})}};return chain},
  }}};
}

test("normaliza categorías visuales cerradas para mantenimiento, comprobante, screenshot, genérica e insuficiente",()=>{
  const fixtures=[
    baseOutput({category:"possible_maintenance_damage",summary:"Se observa humedad aparente.",extracted_fields:{...baseOutput().extracted_fields,observable_issues:["humidity"]},requires_human_review:true}),
    baseOutput({category:"possible_payment_receipt",summary:"Posible comprobante por $1,250.",extracted_fields:{...baseOutput().extracted_fields,amount:1250,currency:"MXN",account_last4:"1234"}}),
    baseOutput({category:"document_or_screenshot",summary:"Captura de pantalla sin validación externa."}),
    baseOutput({category:"property_photo",summary:"Fotografía aparente de un inmueble."}),
    baseOutput({category:"insufficient_visual_evidence",summary:"No hay evidencia visual suficiente."}),
  ];
  for(const fixture of fixtures){const result=validateAndSanitizeMediaInterpretation(fixture);assert.ok(SHADOW_MEDIA_INTERPRETATION_CATEGORIES.includes(result.category));assert.equal(result.interpretation_status,"completed");}
  assert.equal(validateAndSanitizeMediaInterpretation(fixtures[1]).requires_human_review,true);
  assert.equal(validateAndSanitizeMediaInterpretation(fixtures[4]).requires_human_review,true);
});

test("categoría inventada, pago confirmado, diagnóstico definitivo y schema inválido fallan cerrado",()=>{
  assert.throws(()=>validateAndSanitizeMediaInterpretation(baseOutput({category:"new_category"})),/invalid_category/);
  assert.throws(()=>validateAndSanitizeMediaInterpretation(baseOutput({summary:"Pago confirmado y comprobante válido."})),/forbidden_payment_semantics/);
  assert.throws(()=>validateAndSanitizeMediaInterpretation(baseOutput({summary:"Diagnóstico definitivo: causa estructural confirmada."})),/forbidden_diagnostic_semantics/);
  assert.throws(()=>validateAndSanitizeMediaInterpretation({category:"other_image"}),/invalid_shape/);
});

test("PII, cuentas, URLs, identificaciones, firmas y códigos quedan omitidos o enmascarados",()=>{
  const text=sanitizeMediaInterpretationText("persona@example.com +52 222 123 4567 CLABE 123456789012345678 https://private.test Firma de Persona QR:secreto",300);
  assert.match(text,/\[EMAIL\]/);assert.match(text,/\[TELEFONO\]/);assert.match(text,/\[CUENTA \*\*\*\*5678\]/);assert.doesNotMatch(text,/example|123456789012345678|https|Persona|secreto/);
});

test("request visual envía sólo imagen base64, contexto mínimo y schema; nunca URL o payload Respond",async()=>{
  let request;const buffer=Buffer.from([1,2,3]);
  await createAnthropicMediaInterpretation({buffer,mimeType:"image/jpeg",contextText:"Mensaje sanitizado"},{env:enabled,fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({id:"req",model:"haiku",content:[{type:"text",text:JSON.stringify(baseOutput())}],usage:{}})}}});
  assert.equal(request.messages[0].content[0].source.media_type,"image/jpeg");assert.equal(request.messages[0].content[0].source.data,buffer.toString("base64"));assert.match(request.messages[0].content[1].text,/Mensaje sanitizado/);
  assert.doesNotMatch(JSON.stringify(request),/respond_io_token|attachment_url|routing|headers/i);
});

test("flag independiente OFF evita DB y modelo aunque recuperación esté activa",async()=>{
  let called=false;const db=fakeDb();const result=await interpretValidatedShadowImage(db,{claim,buffer:Buffer.alloc(1),validated,env:{...enabled,SHADOW_MEDIA_INTERPRETATION_ENABLED:"false"},modelCall:async()=>{called=true}});
  assert.equal(result.status,"off");assert.equal(called,false);assert.equal(db.writes.length,0);
  assert.equal(mediaInterpretationEnabled({...enabled,SHADOW_MEDIA_RETRIEVAL_ENABLED:"false"}),false);
  assert.equal(mediaInterpretationEnabled({...enabled,SHADOW_OUTBOUND_ENABLED:"true"}),false);
});

test("interpretación completed persiste sólo resultado normalizado y telemetría agregada",async()=>{
  const db=fakeDb({message:"Adjunto imagen"});const result=await interpretValidatedShadowImage(db,{claim,buffer:Buffer.from([1]),validated,env:enabled,modelCall:async()=>modelResult(baseOutput({category:"possible_payment_receipt",summary:"Posible comprobante.",requires_human_review:false}))});
  assert.equal(result.status,"completed");const update=db.writes.find((item)=>item.op==="update").payload;assert.equal(update.status,"completed");assert.equal(update.result_safe.category,"possible_payment_receipt");assert.equal(update.result_safe.requires_human_review,true);assert.equal(update.input_tokens,100);assert.equal(update.output_tokens,20);assert.ok(update.estimated_cost_usd>0);
  assert.doesNotMatch(JSON.stringify(db.writes),/data:image|https?:\/\/|raw_output|prompt|respond_io_token/i);
});

test("output inválido y error proveedor persisten failed sin output bruto; timeout falla cerrado",async()=>{
  for(const [modelCall,expected] of [
    [async()=>modelResult({bad:true}),"invalid_shape"],
    [async()=>{throw Object.assign(new Error("secret provider prose"),{code:"media_model_provider_error",providerError:{provider_request_id:"req_safe"}})},"media_model_provider_error"],
    [async(_input,{signal})=>new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(new Error("late"),{name:"AbortError"})))),"anthropic_timeout"],
  ]){
    const db=fakeDb();const result=await interpretValidatedShadowImage(db,{claim,buffer:Buffer.from([1]),validated,env:{...enabled,SHADOW_MEDIA_INTERPRETATION_TIMEOUT_MS:"2"},modelCall});assert.equal(result.status,"failed");assert.equal(result.error,expected);const update=db.writes.find((item)=>item.op==="update").payload;assert.equal(update.status,"failed");assert.deepEqual(update.result_safe,undefined);assert.doesNotMatch(JSON.stringify(update),/secret provider prose|"late"/);
  }
});

test("idempotencia content hash/runtime evita segunda llamada al modelo",async()=>{
  const db=fakeDb({duplicate:true});let calls=0;const result=await interpretValidatedShadowImage(db,{claim,buffer:Buffer.from([1]),validated,env:enabled,modelCall:async()=>{calls+=1;return modelResult()}});assert.equal(result.status,"duplicate");assert.equal(calls,0);
  const insert=db.writes[0].payload;assert.equal(insert.content_hash,validated.sha256);assert.equal(insert.runtime_version,SHADOW_MEDIA_INTERPRETATION_RUNTIME);
});

test("canal distinto, Ventas, source distinto y PDF nunca interpretan",async()=>{
  for(const bad of [{...claim,channel_id:"498219"},{...claim,channel_id:"497382"},{...claim,channel_source:"other"},{...claim,provider:"other"}]){const db=fakeDb();assert.equal((await interpretValidatedShadowImage(db,{claim:bad,buffer:Buffer.from([1]),validated,env:enabled})).status,"skipped");assert.equal(db.writes.length,0);}
  const db=fakeDb();assert.equal((await interpretValidatedShadowImage(db,{claim,buffer:Buffer.from([1]),validated:{...validated,validatedMime:"application/pdf"},env:enabled})).status,"skipped");
});

test("Auto-Real consume sólo interpretación completed y failed conserva marcador no interpretado",()=>{
  const conversation={id:"c1",provider:"respond_admin",channel:"544519"};const message={id:"m1",conversation_id:"c1",direction:"inbound",occurred_at:"2026-08-25T10:00:00Z",sanitized_text:"Ya quedó\n[IMAGEN]",external_message_id:"ext1",attachment_metadata:[{type:"image",mimeType:"image/jpeg"}],provider_metadata:{}};
  const completed=[{external_message_id:"ext1",status:"completed",result_safe:validateAndSanitizeMediaInterpretation(baseOutput({category:"possible_payment_receipt",summary:"Posible comprobante."}))}];
  const turn=buildRealShadowConversationTurns({messages:[message],conversations:[conversation],mediaInterpretations:completed,now:Date.parse("2026-08-25T10:03:00Z")})[0];const envelope=realShadowTurnEnvelope(turn,conversation);assert.equal(envelope.providerMetadata.attachmentContext.interpreted,true);assert.equal(envelope.providerMetadata.attachmentContext.items[0].interpretation.category,"possible_payment_receipt");const snapshot=createShadowAiInputSnapshot(envelope);assert.equal(snapshot.providerMetadata.attachmentContext.interpreted,true);assert.equal(snapshot.providerMetadata.attachmentContext.items[0].interpretation.interpretationStatus,"completed");
  const failed=buildRealShadowConversationTurns({messages:[message],conversations:[conversation],mediaInterpretations:[{external_message_id:"ext1",status:"failed",result_safe:{}}],now:Date.parse("2026-08-25T10:03:00Z")})[0];assert.equal(failed.attachmentContext.interpreted,false);assert.equal(failed.sanitizedText.includes("[IMAGEN]"),true);
});

test("migración limita resultado, RLS e idempotencia y no concede acceso cliente",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608250003_fase_2b1b_shadow_media_interpretation.sql",import.meta.url),"utf8");
  for(const pattern of [/enable row level security/,/revoke all.*anon,authenticated/s,/unique index.*content_hash,runtime_version/s,/result_safe-array\[/,/status in \('processing','completed','failed'\)/])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/grant .*\b(?:anon|authenticated)\b/i);assert.doesNotMatch(sql,/\b(?:raw_output|binary|base64|attachment_url)\s+(?:text|bytea|jsonb)/i);
});

test("carril visual no contiene outbound ni mutaciones Respond/ERP y runtime sigue Shadow",()=>{
  const files=["../lib/shadow/media/interpretation.js","../lib/shadow/media/worker.js","../pages/api/cron/shadow-media-retrieval.js"].map((path)=>fs.readFileSync(new URL(path,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/RESPOND_IO_TOKEN|send_message|respondRequest|maintenance_tickets\).*update|maintenance_quotes\).*update/i);assert.match(files,/SHADOW_OUTBOUND_ENABLED/);assert.match(files,/SHADOW_MEDIA_INTERPRETATION_ENABLED/);
});
