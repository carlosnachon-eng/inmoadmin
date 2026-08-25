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
import { detectMime, isBlockedIp, resolvePublicHost, secureDownload, validateDownloadedMedia } from "../lib/shadow/media/network.js";
import { processOneMediaRetrieval } from "../lib/shadow/media/worker.js";

const {publicKey,privateKey}=crypto.generateKeyPairSync("rsa",{modulusLength:2048,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});
const payload=(overrides={})=>({event:"message.received",channel:{id:"544519",source:"whatsapp_business"},message:{messageId:"msg-safe",channelId:"544519",message:{attachment:{type:"image",url:"https://media.example.test/object?id=opaque",mimeType:"image/png",size:20,isPending:false}}},...overrides});

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
  const row={id:"q1",...buildEncryptedMediaQueueRow(payload(),{publicKeyPem:publicKey}),attempts:1,locked_by:"w"};const calls=[];
  const admin={rpc:async(name,args)=>{calls.push([name,args]);if(name==="claim_shadow_media_retrieval")return{data:row,error:null};return{data:true,error:null};}};
  const buffer=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId:"00000000-0000-4000-8000-000000000001",download:async()=>({buffer,headerMime:"image/png",sha256:"abc"})});
  assert.equal(result.status,"completed");assert.equal(calls.filter(([name])=>name==="claim_shadow_media_retrieval").length,1);assert.equal(calls.filter(([name])=>name==="complete_shadow_media_retrieval").length,1);assert.ok(!JSON.stringify(calls.at(-1)).includes("https://"));assert.ok(buffer.every((byte)=>byte===0));
});

test("pending temporal reintenta sin exceder cuatro intentos; expirado no se marca completed",async()=>{
  const base={id:"q",...buildEncryptedMediaQueueRow(payload(),{publicKeyPem:publicKey}),attempts:1};const calls=[];const admin={rpc:async(name,args)=>{calls.push([name,args]);return name.startsWith("claim")?{data:base,error:null}:{data:true,error:null};}};
  const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId:"00000000-0000-4000-8000-000000000001",download:async()=>{throw Object.assign(new Error("pending"),{code:"pending_media_unavailable",retryable:true});}});assert.equal(result.status,"pending");assert.equal(calls.at(-1)[1].p_terminal_status,"pending");
});

test("audio/video/Office/SVG/HTML/comprimidos no se descargan en 2B.1A",async()=>{
  for(const mime of ["audio/ogg","video/mp4","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/svg+xml","text/html","application/zip"]){
    const p=payload();p.message.message.attachment.mimeType=mime;const row={id:"q",...buildEncryptedMediaQueueRow(p,{publicKeyPem:publicKey}),attempts:1};let downloaded=false;
    const admin={rpc:async(name)=>name.startsWith("claim")?{data:row,error:null}:{data:true,error:null}};
    const result=await processOneMediaRetrieval(admin,{privateKeyPem:privateKey,workerId:"00000000-0000-4000-8000-000000000001",download:async()=>{downloaded=true;}});assert.equal(result.error,"unsupported_media_for_2b1a");assert.equal(downloaded,false);
  }
});

test("migración fuerza RLS, claim concurrente/lease, TTL, dedupe y borrado criptográfico",()=>{
  const sql=fs.readFileSync(new URL("../supabase/migrations/202608250001_fase_2b1a_shadow_media_retrieval.sql",import.meta.url),"utf8");
  for(const pattern of [/enable row level security/,/revoke all.*anon,authenticated/s,/for update skip locked/,/locked_at<p_now-interval '2 minutes'/,/attempts<4/,/expires_at<=p_now/,/encrypted_reference=null/,/unique index.*provider,external_message_id,attachment_index,reference_hash/s])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/grant .*authenticated/i);
});

test("UI, Shadow normal y worker operacional no reciben referencia ni clave",()=>{
  const files=["../pages/api/operaciones/shadow-coordinator.js","../lib/shadow/operationalEvents.js","../pages/api/cron/shadow-operational-events.js"].map((p)=>fs.readFileSync(new URL(p,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/SHADOW_MEDIA_RETRIEVAL_PRIVATE_KEY|encrypted_reference|claim_shadow_media_retrieval/);
});

test("worker no contiene Anthropic, outbound, Respond writes ni mutaciones ERP; logs no exponen secretos",()=>{
  const worker=fs.readFileSync(new URL("../lib/shadow/media/worker.js",import.meta.url),"utf8");const route=fs.readFileSync(new URL("../pages/api/cron/shadow-media-retrieval.js",import.meta.url),"utf8");
  assert.doesNotMatch(worker+route,/anthropic|RESPOND_IO_TOKEN|send_message|update.*maintenance|insert.*maintenance/i);assert.doesNotMatch(route,/console\.(log|error)\([^)]*(url|cipher|wrapped|nonce|content)/i);assert.match(route,/SHADOW_OUTBOUND_ENABLED/);
});
