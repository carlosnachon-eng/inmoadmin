import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createMetaObserverHandler } from "../lib/messaging/metaObserver/receiver.js";
import { metaObserverConfig, MAX_META_BODY_BYTES } from "../lib/messaging/metaObserver/config.js";
import { normalizeMetaObservations } from "../lib/messaging/metaObserver/normalize.js";
import { createMetaObserverProvider, verifyMetaSignature } from "../lib/messaging/providers/metaObserver.js";
import { messagingRegistry } from "../lib/messaging/registry.js";
import { scope, syntheticEnv, inbound, status, echo, change, payload, fixtures } from "./fixtures/metaObserver.mjs";
import { importWithStubs } from "./helpers/socialFixtures.mjs";

const originalFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("no external HTTP, model, sender, media or workflow");
after(() => { globalThis.fetch = originalFetch; });
export const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k] = v; },
  status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; },
  send(v) { this.body = v; return this; } });
export function request(body = fixtures.inbound, options = {}) {
  const raw = options.raw ?? Buffer.from(JSON.stringify(body));
  return { method: options.method || "POST", query: options.query,
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256="
      + createHmac("sha256", syntheticEnv.META_OBSERVER_APP_SECRET).update(raw).digest("hex"), ...options.headers },
    async *[Symbol.asyncIterator]() { yield raw; } };
}
function harness(options = {}) {
  const calls = [], logs = [], rows = new Map();
  let dbGets = 0;
  const db = { async rpc(name, args) {
    calls.push({ name, args });
    if (options.wait) await options.wait;
    if (options.failure) return { error: { message: "PRIVATE must never leak", code: "08006" } };
    if (options.result) return { data: options.result };
    let inserted = 0;
    for (const e of args.p_events) {
      if (!rows.has(e.event_key)) { rows.set(e.event_key, e); inserted++; }
    }
    return { data: { durable: true, state: "observed", inserted, duplicates: args.p_events.length-inserted } };
  } };
  return { calls, logs, rows, dbGets: () => dbGets,
    handler: createMetaObserverHandler({ getDb: () => { dbGets++; return db; },
      env: () => options.env ?? syntheticEnv, log: code => logs.push(code) }) };
}
async function run(h, req) { const res = response(); await h.handler(req,res); return res; }

test("disabled by default, never initializes DB and cannot select Meta commercially", async () => {
  const h = harness({ env: {} });
  assert.equal((await run(h,request())).statusCode,404);
  assert.equal((await run(h,request({}, {method:"GET"}))).statusCode,404);
  assert.equal(h.dbGets(),0);
  assert.throws(() => messagingRegistry.select("meta"), /messaging_meta_disconnected/);
});
for (const key of Object.keys(syntheticEnv).filter(k=>k!=="META_ADMIN_OBSERVER_ENABLED")) {
  test(`missing ${key} fails closed`, async () => {
    const h=harness({env:{...syntheticEnv,[key]:""}});
    assert.equal((await run(h,request())).statusCode,503); assert.equal(h.dbGets(),0);
  });
}
for (const value of ["false","TRUE"," true ","1",undefined]) test(`activation is exact: ${value}`,()=>{
  assert.equal(metaObserverConfig({...syntheticEnv,META_ADMIN_OBSERVER_ENABLED:value}),null);
});
test("GET challenge exact plain text; no database or secrets in response",async()=>{
  const h=harness(); const res=await run(h,request({}, {method:"GET",query:{"hub.mode":"subscribe",
    "hub.verify_token":syntheticEnv.META_OBSERVER_VERIFY_TOKEN,"hub.challenge":"123456789"}}));
  assert.equal(res.statusCode,200);assert.equal(res.body,"123456789");assert.equal(h.dbGets(),0);
  assert.match(res.headers["Content-Type"],/^text\/plain/);assert.equal(res.headers["Cache-Control"],"no-store");
});
for(const [key,value] of [["hub.mode","unsubscribe"],["hub.verify_token","bad"],["hub.verify_token",[syntheticEnv.META_OBSERVER_VERIFY_TOKEN]],
  ["hub.challenge",["123"]],["hub.challenge","<script>"],["hub.challenge",""]]) test(`reject verification ${key}:${String(value).slice(0,12)}`,async()=>{
  const h=harness();const query={"hub.mode":"subscribe","hub.verify_token":syntheticEnv.META_OBSERVER_VERIFY_TOKEN,"hub.challenge":"123",[key]:value};
  assert.equal((await run(h,request({}, {method:"GET",query}))).statusCode,403);assert.equal(h.dbGets(),0);
});
for(const signature of [undefined,"","sha1=abcd","sha256=zz","sha256="+"0".repeat(64),["sha256="+"0".repeat(64)]])
  test(`invalid signature ${String(signature).slice(0,15)}`,async()=>{
    const h=harness();assert.equal((await run(h,request(undefined,{headers:{"x-hub-signature-256":signature}}))).statusCode,401);
    assert.equal(h.dbGets(),0);
  });
test("HMAC binds exact original bytes, not reparsed JSON",async()=>{
  const h=harness(),req=request();const signature=req.headers["x-hub-signature-256"];
  const raw=Buffer.from(JSON.stringify(fixtures.inbound,null,2));
  assert.equal((await run(h,request(undefined,{raw,headers:{"x-hub-signature-256":signature}}))).statusCode,401);
  assert.equal((await run(h,request(undefined,{raw}))).statusCode,200);
  assert.equal(verifyMetaSignature({},signature,syntheticEnv.META_OBSERVER_APP_SECRET),false);
});
for (const [label,options,code] of [["malformed JSON",{raw:Buffer.from("{")},400],
  ["over limit",{raw:Buffer.alloc(MAX_META_BODY_BYTES+1)},413],
  ["content type",{headers:{"content-type":"text/plain"}},415],["method",{method:"PUT"},405]])
  test(label,async()=>{const h=harness();assert.equal((await run(h,request(undefined,options))).statusCode,code);assert.equal(h.dbGets(),0);});
for(const [label,mutate,code] of [
  ["other WABA",b=>b.entry[0].id="900000000000099",403],
  ["other number",b=>b.entry[0].changes[0].value.metadata.phone_number_id="900000000000099",403],
  ["number missing",b=>delete b.entry[0].changes[0].value.metadata.phone_number_id,403],
  ["native ID missing",b=>delete b.entry[0].changes[0].value.messages[0].id,400],
  ["native ID not fabricated",b=>b.entry[0].changes[0].value.messages[0].id="",400],
  ["numeric ID not coerced",b=>b.entry[0].id=900000000000001,403],
  ["wrong object",b=>b.object="page",400],
  ["malformed array",b=>b.entry[0].changes[0].value.messages={},400],
  ["invalid timestamp",b=>b.entry[0].changes[0].value.messages[0].timestamp="yesterday",400],
  ["empty entries",b=>b.entry=[],400],
]) test(label,async()=>{const b=structuredClone(fixtures.inbound);mutate(b);const h=harness();
  assert.equal((await run(h,request(b))).statusCode,code);assert.equal(h.dbGets(),0);});
test("mixed authorized/unauthorized batch rejects everything",async()=>{
  const b=payload(change(),change());b.entry[0].changes[1].value.metadata.phone_number_id="999999999999999";
  const h=harness();assert.equal((await run(h,request(b))).statusCode,403);assert.equal(h.calls.length,0);
});
test("batch cap",async()=>{
  const h=harness();assert.equal((await run(h,request(payload(change({messages:Array.from({length:101},(_,i)=>inbound(`wamid.SYNTHETIC_${i}`))}))))).statusCode,400);
  assert.equal(h.calls.length,0);
});
for(const [name,fixture] of Object.entries(fixtures)) test(`official wire fixture ${name} is observer-only`,async()=>{
  const h=harness(),res=await run(h,request(fixture));assert.equal(res.statusCode,200);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,"observe_meta_admin_events_v1");
  for(const e of normalizeMetaObservations(fixture,scope).events){
    assert.equal(e.provider,"meta");assert.equal(e.providerEventId,null);assert.equal(e.providerContactId,null);
    assert.equal(e.partyId,null);assert.equal(e.episodeId,null);assert.equal(e.content,null);assert.equal(e.observerOnly,true);
  }
  const journal=JSON.stringify(h.calls[0].args);
  for(const privateValue of ["15555550101","15555550202","Mensaje sintético","private","Not persisted","Synthetic edit"])
    assert.ok(!journal.includes(privateValue));
});
test("each delivery stage persists separately; no downgrade reducer",async()=>{
  const h=harness();await run(h,request(fixtures.statuses));assert.equal(h.rows.size,4);
  assert.deepEqual([...h.rows.values()].map(e=>e.status),["read","sent","delivered","failed"]);
});
test("echo origin is not invented human identity and sent status is not an echo",()=>{
  const provider=createMetaObserverProvider(scope),[e]=provider.normalizeHumanOutbound(fixtures.appEcho);
  assert.deepEqual(e.author,{kind:"unknown",actorId:null,evidence:"smb_message_echoes_app_origin"});
  assert.equal(e.providerMetadata.appOrigin,"whatsapp_business_app_or_linked_device");
  assert.equal(provider.normalizeHumanOutbound(fixtures.statuses).length,0);
  const b=payload(change({messages:[{...inbound(),assignee_id:"123",sender_source:"user"}]}));
  assert.equal(provider.normalizeInbound(b)[0].author.kind,"unknown");
});
test("API echoes/unknown fields do not masquerade as human or inbound",async()=>{
  const h=harness(),b=payload(change({message_echoes:[echo()]},"message_echoes"));
  const res=await run(h,request(b));assert.equal(res.statusCode,200);assert.equal(res.body.ignored,1);assert.equal(h.rows.size,0);
});
test("unknown statuses are explicitly ignored, never mapped to sent",async()=>{
  const h=harness(),res=await run(h,request(payload(change({statuses:[status("played")]}))));
  assert.equal(res.body.ignored,1);assert.equal(h.rows.size,0);
});
test("same native identity is reused; timestamp/text are not dedupe",async()=>{
  const h=harness();await run(h,request());const b=payload();const m=b.entry[0].changes[0].value.messages[0];
  m.timestamp="1791479999";m.text.body="different";
  const res=await run(h,request(b));assert.equal(res.body.duplicates,1);assert.equal(h.rows.size,1);
  assert.equal([...h.rows.values()][0].occurred_at,"2026-10-08T15:03:57.000Z");
  await run(h,request(payload(change({messages:[inbound("wamid.SYNTHETIC_DIFFERENT")]}))));assert.equal(h.rows.size,2);
});
test("no false ACK on persistence error or malformed durability response",async()=>{
  for(const options of [{failure:true},{result:{}},{result:{durable:true,state:"observed",inserted:0,duplicates:0}}]){
    const h=harness(options),res=await run(h,request());assert.equal(res.statusCode,503);
    assert.deepEqual(h.logs,["persistence_failed"]);assert.ok(!JSON.stringify(res).includes("PRIVATE"));
  }
});
test("200 waits for transaction completion",async()=>{
  let commit;const wait=new Promise(resolve=>commit=resolve);const h=harness({wait}),res=response();
  const p=h.handler(request(),res);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(res.statusCode,undefined);commit();await p;assert.equal(res.statusCode,200);
});
test("concurrent duplicates only create one observation (DB concurrency tested separately)",async()=>{
  const h=harness();const rs=await Promise.all(Array.from({length:8},()=>run(h,request())));
  assert.equal(h.rows.size,1);assert.equal(rs.reduce((n,r)=>n+r.body.observed,0),1);
});
test("Meta sends always forbidden, registry unchanged",async()=>{
  const p=createMetaObserverProvider(scope);
  for(const name of ["sendText","sendMedia"])await assert.rejects(p[name]({}),/meta_observer_send_forbidden/);
  assert.equal(messagingRegistry.select().id,"respond");
});
test("real Next route binds only observer to existing guarded DB factory",async()=>{
  const mod=await importWithStubs(new URL("../pages/api/webhooks/meta.js",import.meta.url),{
    "../../../lib/ejecutivo/workCenter":{getAdminSupabase:()=>assert.fail("disabled must not initialize DB")},
  });
  assert.equal(mod.config.api.bodyParser,false);
  const old=process.env.META_ADMIN_OBSERVER_ENABLED;delete process.env.META_ADMIN_OBSERVER_ENABLED;
  try{const res=response();await mod.default(request(),res);assert.equal(res.statusCode,404);}
  finally{if(old!==undefined)process.env.META_ADMIN_OBSERVER_ENABLED=old;}
});
test("observer source has no business effects/imports",async()=>{
  for(const file of ["pages/api/webhooks/meta.js","lib/messaging/metaObserver/receiver.js","lib/messaging/providers/metaObserver.js"]){
    const source=await readFile(new URL(`../${file}`,import.meta.url),"utf8");
    assert.doesNotMatch(source,/from\s+["'][^"']*(?:agentsV2|social\/|shadow\/|respond\/)/);
    assert.doesNotMatch(source,/\bfetch\s*\(|waitUntil\s*\(|\b(?:db|admin)\.from\s*\(/);
  }
});
