import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {encryptMetaMediaId,decryptMetaMediaId,mediaKeyTag} from '../lib/messaging/metaAdminCapture/mediaReference.js';
import {captureMetaAdminInputs,metaAdminCaptureConfig} from '../lib/messaging/metaAdminCapture/capture.js';
import {normalizeMetaObservations} from '../lib/messaging/metaObserver/normalize.js';
import {retrieveMetaAdminMedia} from '../lib/messaging/metaAdminCapture/mediaTransport.js';
import {interpretOpenAIShadowMedia} from '../lib/shadow/media/openaiInterpretation.js';
import {createShadowMediaReader} from '../lib/messaging/metaAdminCapture/shadowMedia.js';
import {secureDownload,MAX_MEDIA_BYTES} from '../lib/shadow/media/network.js';
const env={META_ADMIN_CAPTURE_ENCRYPTION_KEY:'a1'.repeat(32),META_ADMIN_CAPTURE_HMAC_KEY:'b2'.repeat(32),META_ADMIN_OUTBOUND_ACCESS_TOKEN:'synthetic-secret',OPENAI_API_KEY:'synthetic-openai',OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini',META_ADMIN_SHADOW_CAPTURE_ENABLED:'true',META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE:'2026-10-08T00:00:00Z'};
const scope={wabaId:'1297760461811288',phoneNumberId:'1198305790026665'};
const binding={input_id:'a0000000-0000-4000-8000-000000000001',waba_id:scope.wabaId,phone_number_id:scope.phoneNumberId,event_key:'synthetic-event',native_message_id:'wamid.synthetic',subject_ref:'c'.repeat(64),key_tag:mediaKeyTag(env.META_ADMIN_CAPTURE_HMAC_KEY)};
const id='900000000000003';
const envelope=()=>({...binding,media_ciphertext:encryptMetaMediaId(id,binding,env.META_ADMIN_CAPTURE_ENCRYPTION_KEY)});
const png=()=>Buffer.from('89504e470d0a1a0a','hex');
for(const type of ['image','document'])test('future encrypted capture '+type,()=>{
 const body={object:'whatsapp_business_account',entry:[{id:scope.wabaId,changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:scope.phoneNumberId},messages:[{from:'522221234567',id:'wamid.synthetic',timestamp:'1791471837',type,[type]:{id,caption:'private',url:'https://never-store.invalid'}}]}}]}]};
 const [row]=captureMetaAdminInputs(body,normalizeMetaObservations(body,scope).events,scope,metaAdminCaptureConfig(env));
 assert.equal(row.capture_reason,'media_captured');assert.equal(row.sanitized_text,null);
 assert.equal(decryptMetaMediaId(row.media_ciphertext,{...binding,event_key:row.event_key,subject_ref:row.sender_ref,key_tag:row.media_key_tag},env.META_ADMIN_CAPTURE_ENCRYPTION_KEY),id);
 for(const secret of [id,'private','https://','522221234567'])assert.ok(!JSON.stringify(row).includes(secret));
});
test('cipher is scope bound and authenticated',()=>{const e=envelope();assert.equal(decryptMetaMediaId(e.media_ciphertext,e,env.META_ADMIN_CAPTURE_ENCRYPTION_KEY),id);for(const key of ['subject_ref','key_tag','native_message_id','event_key'])assert.throws(()=>decryptMetaMediaId(e.media_ciphertext,{...e,[key]:'d'.repeat(64)},env.META_ADMIN_CAPTURE_ENCRYPTION_KEY));});
for(const variant of ['valid','bad_host','false_mime','oversize','wrong_digest'])test('retrieval '+variant,async()=>{
 const bytes=png();let calls=0;
 const download=async(url,options)=>{calls++;assert.equal(options.bearerToken,env.META_ADMIN_OUTBOUND_ACCESS_TOKEN);assert.equal(options.maxRedirects,0);
  if(calls===1)return {buffer:Buffer.from(JSON.stringify({id,url:variant==='bad_host'?'https://127.0.0.1/x':'https://lookaside.fbsbx.com/x',file_size:variant==='oversize'?MAX_MEDIA_BYTES+1:bytes.length,mime_type:variant==='false_mime'?'image/jpeg':'image/png',sha256:variant==='wrong_digest'?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex')}))};
  return {buffer:bytes,headerMime:'image/png',sha256:createHash('sha256').update(bytes).digest('hex')};};
 if(variant==='valid'){const result=await retrieveMetaAdminMedia(envelope(),{env,download});assert.equal(result.validated.validatedMime,'image/png');}
 else await assert.rejects(()=>retrieveMetaAdminMedia(envelope(),{env,download}),/meta_media_unavailable/);
 if(['bad_host','oversize'].includes(variant))assert.equal(calls,1);
});
test('authenticated network blocks private DNS, redirect and oversize',async()=>{
 const options={bearerToken:'synthetic',allowedHosts:['lookaside.fbsbx.com'],resolver:async()=>[{address:'127.0.0.1',family:4}],request:()=>assert.fail('SSRF request')};
 await assert.rejects(()=>secureDownload('https://lookaside.fbsbx.com/x',options));
 for(const status of [302,200]){
 let calls=0;const request=(o,cb)=>{calls++;const req=new EventEmitter();req.destroy=e=>req.emit('error',e);req.end=()=>queueMicrotask(()=>cb(Object.assign(Readable.from([Buffer.alloc(100)]),{statusCode:status,headers:status===302?{location:'https://lookaside.fbsbx.com/y'}:{'content-length':'100'}})));return req;};
 await assert.rejects(()=>secureDownload('https://lookaside.fbsbx.com/x',{...options,maxBytes:10,resolver:async()=>[{address:'1.1.1.1',family:4}],request}));assert.equal(calls,1);
 }
});
test('Meta PDF uses existing PDF validator before interpretation',async()=>{
 const bytes=Buffer.from('%PDF-1.7 synthetic local fixture'),sha256=createHash('sha256').update(bytes).digest('hex');let calls=0,parses=0;
 const result=await retrieveMetaAdminMedia(envelope(),{env,pdfParser:async b=>{parses++;assert.deepEqual(b,bytes);return {numpages:1};},download:async()=>++calls===1?{buffer:Buffer.from(JSON.stringify({id,url:'https://lookaside.fbsbx.com/document',file_size:bytes.length,mime_type:'application/pdf',sha256}))}:{buffer:bytes,headerMime:'application/pdf',sha256}});
 assert.equal(result.validated.validatedMime,'application/pdf');assert.equal(parses,1);
});
const observation=(type='image',summary='Se observa un posible comprobante. https://private.invalid')=>({media_type:type,interpretation_status:'completed',category:'possible_payment_receipt',summary,extracted_fields:{amount:null,currency:null,date:null,sender_bank:null,recipient_bank:null,reference:null,account_last4:null,observable_issues:[]},confidence:0.8,requires_human_review:true,review_reason:null});
for(const type of ['image','document'])test('OpenAI structured sanitized '+type,async()=>{
 let calls=0;const fetchImpl=async(url,opts)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(opts.body);assert.deepEqual(b.tools,[]);for(const value of [id,env.META_ADMIN_OUTBOUND_ACCESS_TOKEN,'lookaside'])assert.ok(!opts.body.includes(value));return {ok:true,json:async()=>({status:'completed',model:env.OPENAI_ADMIN_AGENT_MODEL,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(observation(type))}]}]})};};
 const result=await interpretOpenAIShadowMedia({buffer:png(),validated:{validatedMime:type==='image'?'image/png':'application/pdf'}},{env,fetchImpl});assert.equal(calls,1);assert.ok(!result.summary.includes('https://'));assert.equal(result.requires_human_review,true);
});
test('payment validated semantics rejected without fallback',async()=>{
 let calls=0;await assert.rejects(()=>interpretOpenAIShadowMedia({buffer:png(),validated:{validatedMime:'image/png'}},{env,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',model:env.OPENAI_ADMIN_AGENT_MODEL,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(observation('image','Pago validado'))}]}]})};}}));assert.equal(calls,1);
});
for(const mode of ['valid','failure','unmatched','unknown'])test('shadow media '+mode,async()=>{
 let reserves=0,models=0;const bytes=png(),now=()=>100000;
 const db={rpc:async name=>name==='meta_admin_memory_evidence_v1'?{data:{...binding,checked_at:new Date(now()).toISOString(),native_verified:true,scope_verified:true,audience:mode==='unknown'?'unknown':'external_verified'}}:(reserves++,{data:envelope()})};
 const read=createShadowMediaReader({db,env,now,retrieve:async()=>{if(mode==='failure')throw Error('secret');return {buffer:bytes};},interpret:async()=>{models++;return {summary:'Posible comprobante observado.'};}});
 const result=await read({inputId:binding.input_id,token:'synthetic',messageType:'image',identityState:mode==='unmatched'?'unmatched':'matched',authorizeInterpretation:async()=>true});
 assert.equal(result.incomplete,true);assert.equal(models,mode==='valid'?1:0);assert.equal(reserves,['unknown','unmatched'].includes(mode)?0:1);assert.ok(!result.text.includes('secret'));if(mode==='valid'){assert.ok(bytes.every(b=>b===0));assert.match(result.text,/no acredita pago conciliado/i);}
});
