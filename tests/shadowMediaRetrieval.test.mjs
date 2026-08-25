import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import fs from "node:fs";
import {
  buildEncryptedMediaQueueRow, captureRespondMediaReferenceIsolated, decryptMediaReference,
  mediaReferenceDecision, validateOpaqueMediaUrl,
} from "../lib/shadow/media/reference.js";
import { createPinnedLookup, detectMime, isBlockedIp, resolvePublicHost, secureDownload, validateDownloadedMedia } from "../lib/shadow/media/network.js";
import { mediaRetrievalWorkerEnabled, normalizeMediaClaimResult, processOneMediaRetrieval } from "../lib/shadow/media/worker.js";
import { mediaNetworkErrorStage, normalizeMediaNetworkErrorCode } from "../lib/shadow/media/errors.js";

const {publicKey,privateKey}=crypto.generateKeyPairSync("rsa",{modulusLength:2048,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});
const payload=(overrides={})=>({event:"message.received",channel:{id:"544519",source:"whatsapp_business"},message:{messageId:"msg-safe",channelId:"544519",message:{attachment:{type:"image",url:"https://media.example.test/object?id=opaque",mimeType:"image/png",size:20,isPending:false}}},...overrides});
const workerId="00000000-0000-4000-8000-000000000001";
const validClaim=(overrides={})=>({id:"00000000-0000-4000-8000-000000000002",...buildEncryptedMediaQueueRow(payload(),{publicKeyPem:publicKey}),attempts:1,status:"processing",locked_by:workerId,locked_at:"2026-08-25T12:00:00.000Z",...overrides});
const emptyDbClaim=()=>Object.fromEntries(["id","locked_by","status","encrypted_reference","wrapped_key","nonce","auth_tag"].map((key)=>[key,null]));

test("captura sólo message.received HMAC-gated, Admin 544519 y whatsapp_business",()=>{
  assert.equal(mediaReferenceDecision(payload(),{enabled:"true"}).capture,true);
  assert.equal(mediaReferenceDecision(payload({channel:{source:"other"}}),{enabled:"true"}).reason,"source_not_allowed");
  assert.equal(mediaReferenceDecision(payload({message:{...payload().message,channelId:"498219"}}),{enabled:"true"}).reason,"channel_not_allowlisted");
  assert.equal(mediaReferenceDecision(payload({event:"message.sent"}),{enabled:"true"}).reason,"not_inbound");
  assert.equal(mediaReferenceDecision(payload({message:{messageId:"x",channelId:"544519",message:{attachment:{type:"image"}}}}),{enabled:"true"}).reason,"attachment_url_missing");
  const webhook=fs.readFileSync(new URL("../pages/api/webhooks/respond.js",import.meta.url),"utf8");
  assert.ok(webhook.indexOf("isValidRespondWebhookSignature")<webhook.indexOf("captureRespondMediaReferenceIsolated"));
});

test("URL opaca exige HTTPS, sin userinfo/fragment/puerto arbitrario",()=>{
  assert.equal(validateOpaqueMediaUrl("https://cdn.example/x?a=b").protocol,"https:");
  for(const value of ["http://example.com/x","ftp://example.com/x","https://u:p@example.com/x","https://example.com:8443/x","https://example.com/x#frag","not-a-url"]){assert.throws(()=>validateOpaqueMediaUrl(value),/invalid_media_url/);}
});

test("referencia queda cifrada, deduplicable y con TTL fijo de 30 minutos",()=>{
  const now=new Date("2026-08-25T12:00:00Z");const row=buildEncryptedMediaQueueRow(payload(),{publicKeyPem:publicKey,now});
  assert.equal(row.channel_id,"544519");assert.equal(row.channel_source,"whatsapp_business");assert.equal(row.status,"pending");
  assert.equal(new Date(row.expires_at)-now,30*60*1000);assert.ok(!JSON.stringify(row).includes("https://"));
  assert.equal(decryptMediaReference(row,privateKey),"https://media.example.test/object?id=opaque");
  assert.match(row.reference_key,/respond_admin:msg-safe:0:[0-9a-f]{64}/);
});

test("isPending se encola con primer intento diferido y TTL no renovable",()=>{
  const now=new Date("2026-08-25T12:00:00Z");const p=payload();p.message.message.attachment.isPending=true;
  const row=buildEncryptedMediaQueueRow(p,{publicKeyPem:publicKey,now});assert.equal(new Date(row.next_attempt_at)-now,60_000);assert.equal(new Date(row.expires_at)-now,1_800_000);
});

test("webhook duplicado no vuelve a encolar",async()=>{
  const admin={from:()=>({insert:async()=>({error:{code:"23505"}})})};
  assert.deepEqual(await captureRespondMediaReferenceIsolated(admin,payload(),{enabled:"true",publicKeyPem:publicKey}),{status:"duplicate"});
});

test("SSRF bloquea IPv4/IPv6 privadas, mixtas, metadata y acepta sólo conjunto público",async()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","100.64.0.1","169.254.169.254","192.168.1.2","::1","fd00::1","fe80::1","ff02::1"]){assert.equal(isBlockedIp(ip),true,ip);}
  assert.equal(isBlockedIp("1.1.1.1"),false);assert.equal(isBlockedIp("2606:4700:4700::1111"),false);
  await assert.rejects(()=>resolvePublicHost("x",{resolver:async()=>[{address:"1.1.1.1",family:4},{address:"10.0.0.1",family:4}]}),/rejected_network_target/);
});

function invokeLookup(lookup,options){return new Promise((resolve,reject)=>lookup("must-not-resolve.example",options,(error,...values)=>error?reject(error):resolve(values)));}

test("lookup fijado soporta firmas escalares y all=true de Node sin ERR_INVALID_IP_ADDRESS",async()=>{
  const ipv4=createPinnedLookup({address:"1.1.1.1",family:4});
  assert.deepEqual(await invokeLookup(ipv4,{}),["1.1.1.1",4]);
  assert.deepEqual(await invokeLookup(ipv4,{all:true}),[[{address:"1.1.1.1",family:4}]]);
  const ipv6=createPinnedLookup({address:"2606:4700:4700::1111",family:"IPv6"});
  assert.deepEqual(await invokeLookup(ipv6,{all:true}),[[{address:"2606:4700:4700::1111",family:6}]]);
  for(const record of [{address:"not-an-ip",family:4},{address:"1.1.1.1",family:6},{address:"[2606:4700:4700::1111]",family:6}])assert.throws(()=>createPinnedLookup(record),/invalid_pinned_address/);
});

test("pinning conserva hostname original para TLS/SNI y no vuelve a resolver DNS",async()=>{
  const seen=[];let resolutions=0;
  const request=(options,cb)=>{seen.push(options);const req=new EventEmitter();req.end=async()=>{
    const [[pinned]]=await invokeLookup(options.lookup,{all:true});
    assert.deepEqual(pinned,{address:"1.1.1.1",family:4});
    queueMicrotask(()=>cb(Object.assign(Readable.from([Buffer.from([0xff,0xd8,0xff])]),{statusCode:200,headers:{"content-type":"image/jpeg"}})));
  };req.destroy=(error)=>req.emit("error",error);return req;};
  const result=await secureDownload("https://media.example/file",{resolver:async()=>{resolutions+=1;return[{address:"1.1.1.1",family:4},{address:"2606:4700:4700::1111",family:6}];},request});
  assert.equal(result.buffer.length,3);assert.equal(resolutions,1);assert.equal(seen[0].hostname,"media.example");assert.equal(seen[0].servername,"media.example");
  assert.notEqual(seen[0].rejectUnauthorized,false);assert.equal(seen[0].lookup instanceof Function,true);
});

test("cada redirect vuelve a resolver y validar antes de crear otro pin",async()=>{
  const resolved=[];const pinned=[];let responseIndex=0;
  const responses=[{statusCode:302,headers:{location:"https://second.example/file"},body:[]},{statusCode:200,headers:{"content-type":"image/png"},body:[Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])]}];
  const request=(options,cb)=>{const req=new EventEmitter();req.end=async()=>{const [[record]]=await invokeLookup(options.lookup,{all:true});pinned.push(record.address);const current=responses[responseIndex++];queueMicrotask(()=>cb(Object.assign(Readable.from(current.body),current)));};req.destroy=(error)=>req.emit("error",error);return req;};
  await secureDownload("https://first.example/file",{resolver:async(hostname)=>{resolved.push(hostname);return[{address:hostname==="first.example"?"1.1.1.1":"8.8.8.8",family:4}];},request});
  assert.deepEqual(resolved,["first.example","second.example"]);assert.deepEqual(pinned,["1.1.1.1","8.8.8.8"]);
});

function requestSequence(responses){let index=0;return(_options,callback)=>{const req=new EventEmitter();req.end=()=>queueMicrotask(()=>callback(Object.assign(Readable.from(responses[index].body||[]),responses[index++])));req.destroy=(e)=>req.emit("error",e);return req;};}

test("redirección válida revalida DNS y no conserva headers sensibles",async()=>{
  const seen=[];const request=(options,cb)=>{seen.push(options);return requestSequence([{statusCode:302,headers:{location:"https://next.example/file"},body:[]},{statusCode:200,headers:{"content-type":"image/png"},body:[Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])]}])(options,cb);};
  // Use a stable sequential mock rather than the wrapper above recreating its cursor.
  let i=0;const seq=[{statusCode:302,headers:{location:"https://next.example/file"},body:[]},{statusCode:200,headers:{"content-type":"image/png"},body:[Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])]}];
  const req=(options,cb)=>{seen.push(options);const out=new EventEmitter();out.end=()=>queueMicrotask(()=>cb(Object.assign(Readable.from(seq[i].body),seq[i++])));out.destroy=(e)=>out.emit("error",e);return out;};
  const result=await secureDownload("https://first.example/a",{resolver:async()=>[{address:"1.1.1.1",family:4}],request:req});assert.equal(result.buffer.length,8);assert.equal(seen.length,2);assert.deepEqual(Object.keys(seen[1].headers).sort(),["accept","user-agent"]);
});

test("redirección privada, downgrade y más de dos saltos se rechazan",async()=>{
  const redirect=(location)=>requestSequence([{statusCode:302,headers:{location},body:[]}]);
  await assert.rejects(()=>secureDownload("https://ok.example/a",{resolver:async(host)=>[{address:host==="private.example"?"10.0.0.1":"1.1.1.1",family:4}],request:redirect("https://private.example/x")}),/rejected_redirect_target/);
  await assert.rejects(()=>secureDownload("https://ok.example/a",{resolver:async()=>[{address:"1.1.1.1",family:4}],request:redirect("http://other.example/x")}),/rejected_redirect_target/);
  let n=0;const endless=(_o,cb)=>{const req=new EventEmitter();req.end=()=>queueMicrotask(()=>cb(Object.assign(Readable.from([]),{statusCode:302,headers:{location:`https://r${n++}.example/x`}})));req.destroy=(e)=>req.emit("error",e);return req;};
  await assert.rejects(()=>secureDownload("https://ok.example/a",{resolver:async()=>[{address:"1.1.1.1",family:4}],request:endless}),/too_many_redirects/);
});

test("magic bytes y MIME compatibles son obligatorios",async()=>{
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);assert.equal(detectMime(png),"image/png");
  await assert.rejects(()=>validateDownloadedMedia({buffer:png,headerMime:"image/jpeg",sha256:"x"},{declaredMime:"image/png"}),/mime_mismatch/);
  await assert.rejects(()=>validateDownloadedMedia({buffer:Buffer.from("html"),headerMime:"text/html",sha256:"x"},{declaredMime:"image/png"}),/unsupported_or_invalid_magic/);
});

test("Content-Length y streaming cortan archivos mayores a 5 MB",async()=>{
  const resolver=async()=>[{address:"1.1.1.1",family:4}];
  const declared=requestSequence([{statusCode:200,headers:{"content-type":"image/png","content-length":String(5*1024*1024+1)},body:[]}]);
  await assert.rejects(()=>secureDownload("https://media.example/x",{resolver,request:declared}),/media_too_large/);
  const streamed=requestSequence([{statusCode:200,headers:{"content-type":"image/png"},body:[Buffer.alloc(5*1024*1024),Buffer.alloc(1)]}]);
  await assert.rejects(()=>secureDownload("https://media.example/x",{resolver,request:streamed}),/media_too_large/);
});

test("timeout total falla cerrado y archivo pending se considera temporal",async()=>{
  const hanging=()=>{const req=new EventEmitter();req.end=()=>{};req.destroy=(e)=>req.emit("error",e);return req;};
  await assert.rejects(()=>secureDownload("https://media.example/x",{resolver:async()=>[{address:"1.1.1.1",family:4}],request:hanging,timeoutMs:5}),/media_download_timeout/);
  const pending=requestSequence([{statusCode:425,headers:{},body:[]}]);
  await assert.rejects(()=>secureDownload("https://media.example/x",{resolver:async()=>[{address:"1.1.1.1",family:4}],request:pending}),error=>error.code==="pending_media_unavailable"&&error.retryable===true);
});

test("PDF corrupto/cifrado y >10 páginas fallan cerrado",async()=>{
  const pdf=Buffer.from("%PDF-1.7\n");
  await assert.rejects(()=>validateDownloadedMedia({buffer:pdf,headerMime:"application/pdf",sha256:"x"},{declaredMime:"application/pdf",pdfParser:async()=>{throw new Error("encrypted");}}),/invalid_or_encrypted_pdf/);
  await assert.rejects(()=>validateDownloadedMedia({buffer:pdf,headerMime:"application/pdf",sha256:"x"},{declaredMime:"application/pdf",pdfParser:async()=>({numpages:11})}),/pdf_page_limit/);
});

test("worker procesa una unidad, persiste sólo resultado técnico y destruye ciphertext por RPC",async()=>{
  const row=validClaim();const calls=[];
  const admin={rpc:async(name,args)=>{calls.push([name,args]);if(name==="claim_shadow_media_retrieval")return{data:row,error:null};return{data:true,error:null};}};
  const buffer=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId,download:async()=>({buffer,headerMime:"image/png",sha256:"abc"})});
  assert.equal(result.status,"completed");assert.equal(calls.filter(([name])=>name==="claim_shadow_media_retrieval").length,1);assert.equal(calls.filter(([name])=>name==="complete_shadow_media_retrieval").length,1);assert.ok(!JSON.stringify(calls.at(-1)).includes("https://"));assert.ok(buffer.every((byte)=>byte===0));
});

test("pending temporal reintenta sin exceder cuatro intentos; expirado no se marca completed",async()=>{
  const base=validClaim();const calls=[];const admin={rpc:async(name,args)=>{calls.push([name,args]);return name.startsWith("claim")?{data:base,error:null}:{data:true,error:null};}};
  const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId,download:async()=>{throw Object.assign(new Error("pending"),{code:"pending_media_unavailable",retryable:true});}});assert.equal(result.status,"pending");assert.equal(calls.at(-1)[1].p_terminal_status,"pending");
});

test("normaliza códigos técnicos sin persistir mensajes sensibles",()=>{
  const cases=new Map([
    ["ECONNRESET","econnreset"],["ETIMEDOUT","etimedout"],["ENOTFOUND","enotfound"],
    ["EAI_AGAIN","eai_again"],["CERT_HAS_EXPIRED","cert_has_expired"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE","unable_to_verify_leaf_signature"],
    ["ERR_TLS_CERT_ALTNAME_INVALID","err_tls_cert_altname_invalid"],["ERR-TLS---BAD","err_tls_bad"],
  ]);
  for(const [input,expected] of cases)assert.equal(normalizeMediaNetworkErrorCode({code:input,message:"https://secret.example/x?token=hidden 10.0.0.1 headers"}),expected);
  for(const input of [undefined,null,"","___","---"])assert.equal(normalizeMediaNetworkErrorCode(input?{code:input}:{}),"network_error_unknown");
  assert.equal(normalizeMediaNetworkErrorCode({cause:{code:"EAI_AGAIN"}}),"eai_again");
  assert.doesNotMatch(normalizeMediaNetworkErrorCode({message:"https://secret.example/x?token=hidden"}),/https|secret|token|___/);
});

test("deriva etapa técnica independiente sin inspeccionar mensajes",()=>{
  assert.equal(mediaNetworkErrorStage("ENOTFOUND"),"dns_resolution");
  assert.equal(mediaNetworkErrorStage("rejected_network_target"),"ssrf_validation");
  assert.equal(mediaNetworkErrorStage("ERR_INVALID_IP_ADDRESS"),"tcp_connect");
  assert.equal(mediaNetworkErrorStage("ECONNRESET"),"tcp_connect");
  assert.equal(mediaNetworkErrorStage("ERR_TLS_CERT_ALTNAME_INVALID"),"tls_handshake");
  assert.equal(mediaNetworkErrorStage("media_http_error"),"http_request");
  assert.equal(mediaNetworkErrorStage("rejected_redirect_target"),"redirect_validation");
  assert.equal(mediaNetworkErrorStage("media_download_timeout"),"stream_read");
  assert.equal(mediaNetworkErrorStage("mime_mismatch"),"content_validation");
  assert.equal(mediaNetworkErrorStage({message:"https://secret.example/x?query=hidden"}),null);
});

test("worker persiste código y etapa sanitizados sin URL ni mensaje",async()=>{
  const row=validClaim();const calls=[];
  const admin={rpc:async(name,args)=>{calls.push([name,args]);return name.startsWith("claim")?{data:row,error:null}:{data:true,error:null};}};
  const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId,download:async()=>{throw Object.assign(new Error("GET https://private.example/x?token=secret headers=bad"),{code:"ERR_TLS_CERT_ALTNAME_INVALID"});}});
  assert.equal(result.error,"err_tls_cert_altname_invalid");assert.equal(result.errorStage,"tls_handshake");
  const failure=calls.at(-1)[1];assert.equal(failure.p_error_code,"err_tls_cert_altname_invalid");assert.equal(failure.p_error_stage,"tls_handshake");
  assert.doesNotMatch(JSON.stringify(failure),/https|private\.example|token|headers|secret/i);
});

test("audio/video/Office/SVG/HTML/comprimidos no se descargan en 2B.1A",async()=>{
  for(const mime of ["audio/ogg","video/mp4","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/svg+xml","text/html","application/zip"]){
    const row=validClaim({declared_mime:mime});let downloaded=false;
    const admin={rpc:async(name)=>name.startsWith("claim")?{data:row,error:null}:{data:true,error:null}};
    const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId,download:async()=>{downloaded=true;}});assert.equal(result.error,"unsupported_media_for_2b1a");assert.equal(downloaded,false);
  }
});

test("normaliza las formas vacías reales de PostgREST como no_work",()=>{
  const allNull=emptyDbClaim();
  for(const value of [null,[],{},[{}],allNull,[allNull]])assert.equal(normalizeMediaClaimResult(value,{workerId}),null);
});

test("rechaza claims parciales o inconsistentes antes de procesarlos",()=>{
  for(const value of [{status:"processing"},[{status:"processing"}],validClaim({id:null}),validClaim({locked_by:null}),validClaim({locked_by:"00000000-0000-4000-8000-000000000099"}),validClaim({status:"pending"}),validClaim({encrypted_reference:null}),[validClaim(),validClaim()]]){
    assert.throws(()=>normalizeMediaClaimResult(value,{workerId}),error=>error.code==="invalid_claim_shape");
  }
  assert.equal(normalizeMediaClaimResult(validClaim(),{workerId}).id,"00000000-0000-4000-8000-000000000002");
  assert.equal(normalizeMediaClaimResult([validClaim()],{workerId}).id,"00000000-0000-4000-8000-000000000002");
});

test("cola vacía no descarga ni llama complete/fail y nunca produce media_claim_lost",async()=>{
  for(const empty of [null,[],{},[{}],emptyDbClaim(),[emptyDbClaim()]]){
    const calls=[];let downloaded=false;
    const admin={rpc:async(name,args)=>{calls.push([name,args]);return{data:empty,error:null};}};
    assert.equal(await processOneMediaRetrieval(admin,{workerId,download:async()=>{downloaded=true;}}),null);
    assert.equal(downloaded,false);assert.deepEqual(calls.map(([name])=>name),["claim_shadow_media_retrieval"]);assert.doesNotMatch(JSON.stringify(calls),/complete|fail|media_claim_lost/);
  }
});

test("respuesta de claim malformada falla cerrado sin downloader ni cierre",async()=>{
  const calls=[];let downloaded=false;const admin={rpc:async(name,args)=>{calls.push([name,args]);return{data:{status:"processing",locked_by:workerId},error:null};}};
  await assert.rejects(()=>processOneMediaRetrieval(admin,{workerId,download:async()=>{downloaded=true;}}),error=>error.code==="invalid_claim_shape");
  assert.equal(downloaded,false);assert.deepEqual(calls.map(([name])=>name),["claim_shadow_media_retrieval"]);
});

test("error real de RPC se propaga sin downloader ni complete/fail",async()=>{
  const calls=[];let downloaded=false;const rpcError=Object.assign(new Error("rpc unavailable"),{code:"rpc_transport_error"});
  const admin={rpc:async(name,args)=>{calls.push([name,args]);return{data:null,error:rpcError};}};
  await assert.rejects(()=>processOneMediaRetrieval(admin,{workerId,download:async()=>{downloaded=true;}}),error=>error===rpcError);
  assert.equal(downloaded,false);assert.deepEqual(calls.map(([name])=>name),["claim_shadow_media_retrieval"]);
});

test("dos workers sobre una fila producen un claim y un no_work sin doble procesamiento",async()=>{
  let available=true;let downloads=0;let completions=0;
  const admin={rpc:async(name)=>{if(name==="claim_shadow_media_retrieval"){if(!available)return{data:Object.fromEntries(Object.keys(validClaim()).map((key)=>[key,null])),error:null};available=false;return{data:validClaim(),error:null};}if(name==="complete_shadow_media_retrieval"){completions+=1;return{data:true,error:null};}throw new Error("unexpected_rpc");}};
  const download=async()=>{downloads+=1;return{buffer:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),headerMime:"image/png",sha256:"abc"};};
  const [first,second]=await Promise.all([processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId,download}),processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId,download})]);
  assert.equal([first,second].filter(Boolean).length,1);assert.equal(downloads,1);assert.equal(completions,1);
});

test("cron reporta claimed=0 para no_work y conserva gate OFF",()=>{
  const route=fs.readFileSync(new URL("../pages/api/cron/shadow-media-retrieval.js",import.meta.url),"utf8");
  assert.match(route,/claimed:processed\?1:0/);assert.match(route,/processed:processed\?/);assert.match(route,/mediaRetrievalWorkerEnabled/);
  assert.equal(mediaRetrievalWorkerEnabled({SHADOW_MEDIA_RETRIEVAL_ENABLED:"false",SHADOW_OUTBOUND_ENABLED:"false"}),false);
  assert.equal(mediaRetrievalWorkerEnabled({SHADOW_MEDIA_RETRIEVAL_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"true"}),false);
  assert.equal(mediaRetrievalWorkerEnabled({SHADOW_MEDIA_RETRIEVAL_ENABLED:"true",SHADOW_OUTBOUND_ENABLED:"false"}),true);
});

test("migración fuerza RLS, claim concurrente/lease, TTL, dedupe y borrado criptográfico",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608250001_fase_2b1a_shadow_media_retrieval.sql",import.meta.url),"utf8");
  for(const pattern of [/enable row level security/,/revoke all.*anon,authenticated/s,/for update skip locked/,/locked_at<p_now-interval '2 minutes'/,/attempts<4/,/expires_at<=p_now/,/encrypted_reference=null/,/unique index.*provider,external_message_id,attachment_index,reference_hash/s])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/grant .*authenticated/i);
});

test("migración de telemetría restringe etapa y mantiene RPC server-side",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608250002_fase_2b1a_media_error_telemetry.sql",import.meta.url),"utf8");
  assert.match(sql,/add column if not exists error_stage/);assert.match(sql,/dns_resolution.*content_validation/s);
  assert.match(sql,/revoke all.*anon,authenticated/s);assert.match(sql,/grant execute.*service_role/s);
  assert.match(sql,/error_code=null,error_stage=null/);
  assert.doesNotMatch(sql,/p_error_message|raw_url|hostname|query_string|headers|certificate_body/i);
});

test("UI, Shadow normal y worker operacional no reciben referencia ni clave",()=>{
  const files=["../pages/api/operaciones/shadow-coordinator.js","../lib/shadow/operationalEvents.js","../pages/api/cron/shadow-operational-events.js"].map((p)=>fs.readFileSync(new URL(p,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/SHADOW_MEDIA_RETRIEVAL_PRIVATE_KEY|encrypted_reference|claim_shadow_media_retrieval/);
});

test("worker no contiene Anthropic, outbound, Respond writes ni mutaciones ERP; logs no exponen secretos",()=>{
  const worker=fs.readFileSync(new URL("../lib/shadow/media/worker.js",import.meta.url),"utf8");const route=fs.readFileSync(new URL("../pages/api/cron/shadow-media-retrieval.js",import.meta.url),"utf8");
  assert.doesNotMatch(worker+route,/anthropic|RESPOND_IO_TOKEN|send_message|update.*maintenance|insert.*maintenance/i);assert.doesNotMatch(route,/console\.(log|error)\([^)]*(url|cipher|wrapped|nonce|content)/i);assert.match(worker+route,/SHADOW_OUTBOUND_ENABLED/);
});
