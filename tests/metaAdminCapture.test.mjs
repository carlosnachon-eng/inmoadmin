import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { captureMetaAdminInputs, metaAdminCaptureConfig } from "../lib/messaging/metaAdminCapture/capture.js";
import { metaNativeAttentionGate, prepareMetaAdminShadow, resolveMetaAdminIdentity } from "../lib/messaging/metaAdminCapture/preflight.js";
import { normalizeMetaObservations } from "../lib/messaging/metaObserver/normalize.js";
import { createMetaObserverHandler } from "../lib/messaging/metaObserver/receiver.js";
import { scope, syntheticEnv, inbound as observerInbound, change, payload, fixtures as observerFixtures } from "./fixtures/metaObserver.mjs";
import { normalizeIdentityPhone } from "../lib/shadow/identityBridge.js";

// Capture uses the existing Mexican canonical identity semantics. Keep the
// generic observer fixtures unchanged: observer-only still accepts other scopes.
const inbound = (...args) => ({ ...observerInbound(...args), from: "522221234567" });
const fixtures = { ...observerFixtures, inbound: payload(change({ messages: [inbound()] })),
  media: payload(change({ messages: [{ ...observerFixtures.media.entry[0].changes[0].value.messages[0], from: inbound().from }] })) };

const env = { ...syntheticEnv, META_ADMIN_SHADOW_CAPTURE_ENABLED: "true",
  META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE: "2026-10-08T00:00:00.000Z",
  META_ADMIN_CAPTURE_ENCRYPTION_KEY: "a1".repeat(32), META_ADMIN_CAPTURE_HMAC_KEY: "b2".repeat(32) };
const config = metaAdminCaptureConfig(env);
const capture = b => captureMetaAdminInputs(b, normalizeMetaObservations(b, scope).events, scope, config);
const fetchBefore = globalThis.fetch;
globalThis.fetch = () => assert.fail("external model or transport forbidden");
after(() => { globalThis.fetch = fetchBefore; });
const response = () => ({ status(n) { this.statusCode=n; return this; }, setHeader() {},
  json(data) { this.data=data; return this; }, send(data) { this.data=data; return this; } });
async function http(body=fixtures.inbound, options={}) {
  const raw=Buffer.from(JSON.stringify(body)); const calls=[], logs=[];
  const handler=createMetaObserverHandler({ env:()=>options.env||env, log:code=>logs.push(code), getDb:()=>({
    async rpc(name,args) { calls.push({name,args}); if(options.error) return {error:{message:"private body must not escape"}};
      return {data: options.result || {durable:true,state:"observed",inserted:args.p_events.length,duplicates:0,
        captured:args.p_inputs?.length||0,capture_durable:true,subjects_durable:true}}; } }) });
  const req={method:"POST",headers:{"content-type":"application/json","x-hub-signature-256":options.signature??
    "sha256="+createHmac("sha256",env.META_OBSERVER_APP_SECRET).update(raw).digest("hex")},async *[Symbol.asyncIterator](){yield raw;}};
  const res=response(); await handler(req,res); return {res,calls,logs};
}
test("capture OFF is the existing observer RPC and metadata only",async()=>{
  const {res,calls}=await http(fixtures.inbound,{env:syntheticEnv}); assert.equal(res.statusCode,200);
  assert.equal(calls[0].name,"observe_meta_admin_events_v1"); assert.equal(calls[0].args.p_inputs,undefined);
  assert.equal(JSON.stringify(calls).includes("Mensaje sintético"),false);
});
for(const key of ["META_ADMIN_SHADOW_CAPTURE_NOT_BEFORE","META_ADMIN_CAPTURE_ENCRYPTION_KEY","META_ADMIN_CAPTURE_HMAC_KEY"])
  test(`capture config requires ${key}`,()=>assert.throws(()=>metaAdminCaptureConfig({...env,[key]:""}),/capture_invalid/));
for(const value of [undefined,"false","TRUE","1"]) test(`capture exact activation ${value}`,()=>{
  assert.equal(metaAdminCaptureConfig({...env,META_ADMIN_SHADOW_CAPTURE_ENABLED:value}),null);
});
test("independent encryption and HMAC keys",()=>assert.throws(()=>metaAdminCaptureConfig({...env,META_ADMIN_CAPTURE_HMAC_KEY:env.META_ADMIN_CAPTURE_ENCRYPTION_KEY}),/capture_invalid/));
test("sanitizes text; encrypted exact address; no names/profiles/raw payload",()=>{
  const m={...inbound(),text:{body:"Agua atrasada. correo a@b.com teléfono 2221234567 https://ejemplo.test cuenta 123456789012345678\u0000"}};
  const body=payload(change({contacts:[{wa_id:m.from,profile:{name:"PROFILE MUST NOT PERSIST"}}],messages:[m]}));
  const [row]=capture(body); const wire=JSON.stringify(row);
  assert.match(row.sanitized_text,/Agua atrasada/);
  for(const secret of [m.from,"a@b.com","2221234567","ejemplo.test","123456789012345678","PROFILE MUST NOT PERSIST","\u0000"])
    assert.equal(wire.includes(secret),false);
  assert.equal(row.sender_evidence,"signed_from_and_wa_id");
  const c=row.sender_ciphertext; const decipher=createDecipheriv("aes-256-gcm",Buffer.from(config.encryptionKey,"hex"),Buffer.from(c.iv,"hex"));
  decipher.setAAD(Buffer.from(`${scope.wabaId}:${scope.phoneNumberId}:${row.event_key}`));decipher.setAuthTag(Buffer.from(c.tag,"hex"));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(c.data,"hex")),decipher.final()]).toString(),m.from);
  assert.equal(row.exact_phone_digest,createHash("sha256").update(m.from).digest("hex"));
});
test("sender reference stable in scope, ciphertext randomized on retry",()=>{
  const [a]=capture(fixtures.inbound),[b]=capture(fixtures.inbound);
  assert.equal(a.sender_ref,b.sender_ref);assert.notDeepEqual(a.sender_ciphertext,b.sender_ciphertext);
});
test("identical native-ID duplicates in one batch create one input",()=>{
  assert.equal(capture(payload(change({messages:[inbound(),inbound()]}))).length,1);
});
test("conflicting subjects for one native ID never choose first or last",()=>{
  assert.throws(()=>capture(payload(change({messages:[inbound(),{...inbound(),from:"15555550102"}]}))),/capture_invalid/);
});
test("mutation sharing native ID is an observation, not another shadow input",()=>{
  const m=inbound();const revoke={...m,type:"revoke",text:undefined,revoke:{original_message_id:m.id}};
  assert.equal(capture(payload(change({messages:[m,revoke]}))).length,1);
});
for(const from of ["5212221234567","522221234567","2221234567"]) test(`canonical phone digest ${from.length} digits; raw address stays encrypted`,async()=>{
  const body=payload(change({contacts:[{wa_id:from}],messages:[{...inbound(),from}]}));
  const [row]=capture(body);
  assert.equal(normalizeIdentityPhone(from),"522221234567");
  assert.equal(row.exact_phone_digest,createHash("sha256").update("522221234567").digest("hex"));
  assert.equal(row.sender_ref,createHmac("sha256",Buffer.from(config.hmacKey,"hex")).update(`${scope.wabaId}:${scope.phoneNumberId}:${from}`).digest("hex"));
  const c=row.sender_ciphertext,decipher=createDecipheriv("aes-256-gcm",Buffer.from(config.encryptionKey,"hex"),Buffer.from(c.iv,"hex"));
  decipher.setAAD(Buffer.from(`${scope.wabaId}:${scope.phoneNumberId}:${row.event_key}`));decipher.setAuthTag(Buffer.from(c.tag,"hex"));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(c.data,"hex")),decipher.final()]).toString(),from);
  const {res,calls,logs}=await http(body);assert.equal(res.statusCode,200);
  for(const value of [from,"522221234567"])for(const output of [row,calls,res.data,logs])assert.equal(JSON.stringify(output).includes(value),false);
});
test("canonical digest does not fuzzy-match similar numbers or wrong area prefixes",()=>{
  const expected=createHash("sha256").update("522221234567").digest("hex");
  for(const from of ["522221234568","523221234567","1221234567"]){
    const [row]=capture(payload(change({messages:[{...inbound(),from}]})));
    assert.notEqual(row.exact_phone_digest,expected);
  }
});
for(const from of ["12345678","222123456","15555550101","532221234567","5222221234567","52122212345678"])
  test(`canonical normalization failure is fail-closed (${from.length} digits/${from.slice(0,3)})`,async()=>{
    assert.equal(normalizeIdentityPhone(from),null);
    const body=payload(change({messages:[{...inbound(),from}]}));
    assert.throws(()=>capture(body),/capture_invalid/);
    const {res,calls,logs}=await http(body);assert.equal(res.statusCode,503);assert.equal(calls.length,0);
    assert.deepEqual(logs,["persistence_failed"]);assert.equal(JSON.stringify({res,logs}).includes(from),false);
  });
for(const from of [undefined,"","+522221234567","222 123 4567",15555550101,"abc","01123456"])
  test(`rejects nonattested address ${String(from)}`,()=>assert.throws(()=>capture(payload(change({messages:[{...inbound(),from}]}))),/capture_invalid/));
for(const contacts of [[],{},[{wa_id:"15555559999"}],[{wa_id:inbound().from},{wa_id:inbound().from}]])
  test(`contact wa_id mismatch or ambiguity ${JSON.stringify(contacts)}`,()=>assert.throws(()=>capture(payload(change({contacts,messages:[inbound()]}))),/capture_invalid/));
test("cutoff rejects prior event, even newly delivered",()=>{
  assert.deepEqual(capture(payload(change({messages:[{...inbound(),timestamp:"1791417599"}]}))),[]);
});
test("nontext never loads caption, URL, downloads or fabricates input",()=>{
  const [row]=capture(fixtures.media);assert.equal(row.sanitized_text,null);assert.equal(row.capture_reason,"unsupported_message_type");
  assert.equal(JSON.stringify(row).includes("private"),false);
});
for(const key of ["statuses","appEcho","edit","revoke"]) test(`no shadow input for ${key}`,()=>assert.deepEqual(capture(fixtures[key]),[]));
test("empty sanitized text blocked",()=>assert.equal(capture(payload(change({messages:[{...inbound(),text:{body:" \u0000 "}}]})))[0].capture_reason,"empty_sanitized_text"));
test("invalid HMAC never initializes capture or DB",async()=>{
  const {res,calls}=await http(fixtures.inbound,{signature:"sha256="+"0".repeat(64)});
  assert.equal(res.statusCode,401);assert.equal(calls.length,0);
});
test("scope validation still runs before capture",async()=>{
  const b=structuredClone(fixtures.inbound);b.entry[0].id="900000000009999";
  const {res,calls}=await http(b);assert.equal(res.statusCode,403);assert.equal(calls.length,0);
});
test("one atomic durable RPC, no model/sender call",async()=>{
  const {res,calls}=await http();assert.equal(res.statusCode,200);assert.equal(calls.length,1);
  assert.equal(calls[0].name,"capture_meta_admin_shadow_subject_v1");assert.equal(calls[0].args.p_inputs.length,1);
  assert.equal(res.data.observerOnly,true);assert.equal(JSON.stringify(res.data).includes("sender"),false);
});
test("capture DB failure gives 503, sanitized log",async()=>{
  const {res,logs}=await http(fixtures.inbound,{error:true});assert.equal(res.statusCode,503);
  assert.deepEqual(logs,["persistence_failed"]);assert.equal(JSON.stringify(res).includes("private body"),false);
});
test("legacy-only durable result is not a false capture ACK",async()=>{
  const {res}=await http(fixtures.inbound,{result:{durable:true,state:"observed",inserted:1,duplicates:0}});
  assert.equal(res.statusCode,503);
});
test("native attention remains unknown; no injected boolean can unblock",()=>{
  const gate=metaNativeAttentionGate({blocked:false,sender_source:"user",assignee_id:123});
  assert.equal(gate.blocked,true);assert.equal(gate.humanAuthorshipProven,false);assert.equal(gate.resumeSupported,false);
});
const inputId="00000000-0000-4000-8000-000000000001";
for(const state of ["matched","ambiguous","unmatched"]) test(`read-only identity ${state} is not business authority`,async()=>{
  const calls=[];const result=await resolveMetaAdminIdentity({inputId,db:{async rpc(name,args){calls.push(name);return{data:{state,authorizes_business:false}};}}});
  assert.equal(result.state,state);assert.deepEqual(calls,["resolve_meta_admin_identity_v1"]);
});
test("bridge cannot accept an authorization smuggled into response",async()=>{
  await assert.rejects(resolveMetaAdminIdentity({inputId,db:{rpc:async()=>({data:{state:"matched",authorizes_business:true}})}}),/identity_unverified/);
});
test("shadow preflight cannot report invented run/output",async()=>{
  const data={status:"blocked",model_calls:0,send_calls:0,run_id:null,proposed_response:null};
  assert.deepEqual(await prepareMetaAdminShadow({inputId,db:{rpc:async()=>({data})}}),data);
  await assert.rejects(prepareMetaAdminShadow({inputId,db:{rpc:async()=>({data:{...data,run_id:"fake"}})}}),/preflight_failed/);
});
test("preflight has no model, sender, Respond or correlation dependency",async()=>{
  const source=await readFile(new URL("../lib/messaging/metaAdminCapture/preflight.js",import.meta.url),"utf8");
  assert.equal(/^import /m.test(source),false);assert.equal(/\bfetch\s*\(/.test(source),false);
});
