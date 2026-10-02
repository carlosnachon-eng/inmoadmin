import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MATERIAL_CODES, MATERIAL_STAGE, MATERIAL_CLARIFICATION, selectOwnerMaterial, deliveryMode, materialsEnabled, guardOwnerMaterialResponse, rentalGuaranteeText } from "../lib/ownerMaterials/policy.js";
import { verifyMaterialBytes, registerApprovedMaterial } from "../lib/ownerMaterials/assets.js";
import { deliverOwnerMaterial } from "../lib/ownerMaterials/delivery.js";
import { materialLink, verifyMaterialLink } from "../lib/ownerMaterials/links.js";
import { createMaterialDownloadHandler } from "../lib/ownerMaterials/download.js";

const id = n => `aa000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const bytes = Buffer.from("%PDF-1.4\nsynthetic fixture only\n%%EOF\n");
const hash = createHash("sha256").update(bytes).digest("hex");
const env = { OWNER_APPROVED_MATERIALS_V1_ENABLED:"true", OWNER_APPROVED_MATERIALS_ORIGIN:"https://materials.example.test", OWNER_APPROVED_MATERIALS_LINK_SECRET:"synthetic-key-not-a-real-secret-0001", RESPOND_IO_TOKEN:"synthetic-only" };
const inbound = { id:id(1), respond_contact_id:"900001", channel_id:"498219", sanitized_text:"Quiero rentar mi casa", occurred_at:new Date().toISOString(), status:"processing" };
const version = (code=MATERIAL_CODES.rent, n=1) => ({ id:id(10+n), material_code:code, version:`v${n}`, filename:"synthetic.pdf", sha256:hash, byte_size:bytes.length, object_path:`${code}/${hash}.pdf`, active:true, valid_from:"2020-01-01T00:00:00Z", valid_until:"2099-01-01T00:00:00Z" });
function fixture(options={}) {
  const tables = { owner_approved_material_versions:[version(),version(MATERIAL_CODES.sale,2)], owner_material_deliveries:[], profiles:[{id:id(90),role_id:"admin",active:true}], ...options.tables };
  let fetches=[], downloads=0, rpcs=[];
  const db = { tables, storage:{ from(bucket){ assert.equal(bucket,"owner-approved-materials"); return {
    async download(){ downloads++; return options.storageError?{error:true}:{data:new Blob([options.bytes||bytes])}; },
    async upload(_path,buffer,opts){ assert.deepEqual(Buffer.from(buffer),bytes); assert.equal(opts.upsert,false);return {error:null}; },
  }; } },
    async rpc(name,args){ rpcs.push(name); if(options.rpcError)return {error:true};
      if(name==="reserve_owner_material_delivery") {
        const duplicate=tables.owner_material_deliveries.find(d=>d.respond_contact_id===inbound.respond_contact_id&&d.material_code===args.p_material_code);
        if(duplicate)return {data:{id:duplicate.id,created:false}};
        const v=tables.owner_approved_material_versions.find(v=>v.active&&v.material_code===args.p_material_code&&Date.parse(v.valid_until)>Date.now());
        if(!v)return {data:null};
        const d={id:id(50+tables.owner_material_deliveries.length),version_id:v.id,material_code:v.material_code,respond_contact_id:inbound.respond_contact_id,stage_key:MATERIAL_STAGE,inbound_message_id:args.p_inbound_id,run_id:args.p_run_id,delivery_mode:args.p_delivery_mode,status:"reserved"};
        tables.owner_material_deliveries.push(d); return {data:{id:d.id,version_id:v.id,created:true}};
      }
      assert.equal(name,"claim_owner_material_delivery");
      if(options.claimBlocked)return {data:null};
      const d=tables.owner_material_deliveries.find(d=>d.id===args.p_delivery_id&&d.status==="reserved");
      if(!d)return {data:null}; Object.assign(d,{status:"dispatching",link_expires_at:new Date(Date.now()+3600000).toISOString()});return {data:{...d}};
    },
    from(name) {
      assert.ok(tables[name],name); let filters=[],patch,insert,single=false;
      const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},update(p){patch=p;return q;},insert(p){insert=p;return q;},then(ok,fail){
        if(options.persistenceError&&name==="owner_material_deliveries"&&patch)return Promise.resolve({error:true}).then(ok,fail);
        if(insert)tables[name].push({...insert,id:id(99)});
        const rows=tables[name].filter(r=>filters.every(f=>f(r)));if(patch)rows.forEach(r=>Object.assign(r,patch));
        return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(ok,fail);
      }};return q;
    },
  };
  const fetchImpl=async(url,init)=>{fetches.push({url,init});if(options.networkError)throw new Error("https://SECRET.example value alias raw-PII");return {ok:!options.providerError,json:async()=>({messageId:1001})};};
  return {db,fetchImpl,fetches,get downloads(){return downloads;},rpcs};
}

for(const [text,code] of [["Quiero rentar mi casa",MATERIAL_CODES.rent],["Me interesa la administración de propiedades",MATERIAL_CODES.rent],["Quiero vender mi departamento",MATERIAL_CODES.sale]]) {
  test(`selection ${text}`,()=>assert.equal(selectOwnerMaterial(text).code,code));
  test(`delivery ${text}`,async()=>{const f=fixture();const r=await deliverOwnerMaterial(f.db,{...inbound,sanitized_text:text},id(2),{env,fetchImpl:f.fetchImpl});assert.equal(r.status,"sent");assert.equal(r.materialCode,code);assert.equal(f.fetches.length,1);assert.equal(f.db.tables.owner_material_deliveries[0].run_id,id(2));assert.ok(f.db.tables.owner_material_deliveries[0].sent_at);});
}
for(const text of ["Me pasas la presentación", "Quiero rentar o vender", "No quiero vender", "Tal vez rentar"])test(`ambiguity no file: ${text}`,async()=>{const f=fixture();assert.equal(selectOwnerMaterial(text).kind,"clarify");assert.equal(guardOwnerMaterialResponse("sí",selectOwnerMaterial(text)),MATERIAL_CLARIFICATION);await deliverOwnerMaterial(f.db,{...inbound,sanitized_text:text},id(2),{env,fetchImpl:f.fetchImpl});assert.equal(f.fetches.length,0);assert.equal(f.rpcs.length,0);});
test("ordinary follow-up does not invent a new stage or send",async()=>{const f=fixture();await deliverOwnerMaterial(f.db,{...inbound,sanitized_text:"Perfecto"},id(2),{env,fetchImpl:f.fetchImpl});assert.equal(f.fetches.length,0);});
test("OFF does not read DB/storage or call Respond",async()=>{assert.equal(materialsEnabled({}),false);assert.equal(materialsEnabled({OWNER_APPROVED_MATERIALS_V1_ENABLED:"TRUE"}),false);const f=fixture();assert.deepEqual(await deliverOwnerMaterial(null,inbound,id(2),{env:{},fetchImpl:f.fetchImpl}),{status:"disabled"});assert.equal(f.fetches.length,0);});
for(const [channel,mode] of [["498219","document"],["515318","document"],["497382","temporary_link"],["497385","temporary_link"]])test(`channel ${channel}: ${mode}`,async()=>{
  assert.equal(deliveryMode(channel),mode);const f=fixture();const r=await deliverOwnerMaterial(f.db,{...inbound,channel_id:channel},id(2),{env,fetchImpl:f.fetchImpl});assert.equal(r.mode,mode);
  const body=JSON.parse(f.fetches[0].init.body);assert.equal(body.channelId,Number(channel));assert.equal(body.message.type,mode==="document"?"attachment":"text");
  const url=mode==="document"?body.message.attachment.url:body.message.text.match(/https:\/\/[^\s]+/)[0];assert.match(url,/materials.example.test\/api\/owner-materials\/download\?t=/);assert.ok(verifyMaterialLink(new URL(url).searchParams.get("t"),env));
  assert.doesNotMatch(JSON.stringify(f.db.tables.owner_material_deliveries),/https:|synthetic-key|SECRET/);
});
for(const channel of ["544519","unknown",null])test(`unsupported channel ${channel}`,async()=>{const f=fixture();const r=await deliverOwnerMaterial(f.db,{...inbound,channel_id:channel},id(2),{env,fetchImpl:f.fetchImpl});assert.equal(r.status,"blocked");assert.equal(f.fetches.length,0);});
test("concurrent calls and later-message retry: at most one dispatch per stage/code",async()=>{const f=fixture();const results=await Promise.all(Array.from({length:12},()=>deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl})));assert.equal(results.filter(x=>x.status==="sent").length,1);assert.equal(f.fetches.length,1);const later=await deliverOwnerMaterial(f.db,{...inbound,id:id(3)},id(4),{env,fetchImpl:f.fetchImpl});assert.equal(later.status,"duplicate_suppressed");assert.equal(f.db.tables.owner_material_deliveries.length,1);});
test("new version chosen for new delivery, never resends same material/stage",async()=>{const f=fixture();f.db.tables.owner_approved_material_versions[0].active=false;f.db.tables.owner_approved_material_versions.push(version(MATERIAL_CODES.rent,3));const r=await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});assert.equal(r.version,"v3");f.db.tables.owner_approved_material_versions.push(version(MATERIAL_CODES.rent,4));assert.equal((await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl})).status,"duplicate_suppressed");assert.equal(f.fetches.length,1);});
for(const setting of [{networkError:true},{providerError:true},{persistenceError:true}])test(`uncertain result never retries: ${JSON.stringify(setting)}`,async()=>{const f=fixture(setting);const r=await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});assert.equal(r.status,"uncertain");assert.doesNotMatch(JSON.stringify(r),/SECRET|alias|PII/);await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});assert.equal(f.fetches.length,1);});
for(const setting of [{storageError:true},{bytes:Buffer.from("tampered")},{claimBlocked:true}])test(`pre-send failure never reaches provider ${JSON.stringify(setting)}`,async()=>{const f=fixture(setting);const r=await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});assert.equal(r.status,"blocked");assert.equal(f.fetches.length,0);await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});assert.equal(f.fetches.length,0);});
test("missing/expired active catalog fails closed",async()=>{const f=fixture();f.db.tables.owner_approved_material_versions[0].valid_until="2020-01-01";assert.equal((await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl})).status,"unavailable");assert.equal(f.fetches.length,0);});
for(const flags of [{},{residentialConfirmed:true},{exclusiveContractConfirmed:true},{residentialConfirmed:false,exclusiveContractConfirmed:true}])test(`guarantee conditional ${JSON.stringify(flags)}`,()=>assert.match(rentalGuaranteeText(flags),/no confirmamos/));
test("both verified guarantee conditions allow mention",()=>assert.doesNotMatch(rentalGuaranteeText({residentialConfirmed:true,exclusiveContractConfirmed:true}),/no confirmamos/));
for(const text of ["En tu caso aplica la garantía", "Rentamos en 30 días", "Te garantizamos veinte por ciento de descuento", "Descuento del 20%", "Te garantizo rentar en treinta días"])test(`unverified model guarantee replaced: ${text}`,()=>{const result=guardOwnerMaterialResponse(text,{kind:"material"});assert.equal(result,rentalGuaranteeText());assert.match(result,/habitacionales.*exclusiva/);});
test("model URL cannot choose files",()=>assert.doesNotMatch(guardOwnerMaterialResponse("PDF https://unapproved.test/file.pdf",{kind:"material"}),/https/));
test("byte verification and original buffers remain unchanged",()=>{const before=Buffer.from(bytes);assert.deepEqual(verifyMaterialBytes(bytes,version()),before);assert.deepEqual(bytes,before);assert.throws(()=>verifyMaterialBytes(bytes,{...version(),sha256:"0".repeat(64)}),/integrity/);});
test("register: admin only, private immutable PDF inactive until separate activation",async()=>{const f=fixture();await registerApprovedMaterial(f.db,{bytes,materialCode:MATERIAL_CODES.rent,version:"approved-v1",filename:"rent.pdf",sha256:hash,byteSize:bytes.length,approvedBy:id(90),validUntil:"2099-01-01"});assert.equal(f.db.tables.owner_approved_material_versions.at(-1).active,false);f.db.tables.profiles[0].role_id="asesor";await assert.rejects(registerApprovedMaterial(f.db,{approvedBy:id(90)}),/admin_required/);});

test("temporary capability rejects expiry, tampering, wrong key and indefinite URL",()=>{
  const now=Date.now(),url=materialLink(id(50),new Date(now+3600000).toISOString(),env),token=new URL(url).searchParams.get("t");
  assert.ok(verifyMaterialLink(token,env,now));assert.equal(verifyMaterialLink(token,env,now+3600000),null);assert.equal(verifyMaterialLink(token.replace("aa000", "bb000"),env,now),null);assert.equal(verifyMaterialLink(token,{...env,OWNER_APPROVED_MATERIALS_LINK_SECRET:"other-synthetic-secret-key-0000000000"},now),null);assert.equal(verifyMaterialLink("unknown",env),null);
});
async function download(f,token,options={}){const headers={};const res={setHeader(k,v){headers[k]=v;},status(s){this.statusCode=s;return this;},end(body){this.body=body;return this;}};await createMaterialDownloadHandler({createAdmin:()=>f.db,env,...options})({method:"GET",query:{t:token}},res);return {...res,headers};}
test("download serves exact approved bytes with no-store, no public bucket URL",async()=>{const f=fixture();await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});const token=new URL(JSON.parse(f.fetches[0].init.body).message.attachment.url).searchParams.get("t");const r=await download(f,token);assert.equal(r.statusCode,200);assert.deepEqual(r.body,bytes);assert.match(r.headers["Cache-Control"],/no-store/);assert.equal(r.headers["Vercel-CDN-Cache-Control"],"no-store");assert.equal(r.headers["Referrer-Policy"],"no-referrer");f.db.tables.owner_approved_material_versions[0].active=false;assert.equal((await download(f,token)).statusCode,404);});
test("download OFF/forged/expired never exposes storage or metadata",async()=>{const f=fixture();assert.equal((await download(f,"bad")).statusCode,404);assert.equal((await download(f,"bad",{env:{}})).statusCode,404);assert.equal(f.downloads,0);});
test("expiry reached during Storage download fails closed",async()=>{
  const f=fixture();await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});
  const token=new URL(JSON.parse(f.fetches[0].init.body).message.attachment.url).searchParams.get("t");
  const initial=Date.now();let reads=0;
  const response=await download(f,token,{now:()=>++reads>=4?initial+3600001:initial});
  assert.equal(response.statusCode,404);assert.equal(response.body,undefined);
});
test("corrupted stored PDF is never downloaded to recipient",async()=>{
  const f=fixture();await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl});
  const token=new URL(JSON.parse(f.fetches[0].init.body).message.attachment.url).searchParams.get("t");
  f.db.storage.from=()=>({download:async()=>({data:new Blob(["not an approved PDF"])})});
  assert.equal((await download(f,token)).statusCode,404);
});
test("bad origin/weak signing key block before reservation or dispatch",async()=>{
  for(const patch of [{OWNER_APPROVED_MATERIALS_ORIGIN:"http://example.test"},{OWNER_APPROVED_MATERIALS_ORIGIN:"https://user:password@example.test"},{OWNER_APPROVED_MATERIALS_LINK_SECRET:"short"}]){
    const f=fixture();const r=await deliverOwnerMaterial(f.db,inbound,id(2),{env:{...env,...patch},fetchImpl:f.fetchImpl});
    assert.equal(r.status,"blocked");assert.equal(f.fetches.length,0);assert.equal(f.rpcs.length,0);
  }
});
test("unknown library path cannot repurpose private conversational attachments",async()=>{
  const f=fixture();f.db.tables.owner_approved_material_versions[0].object_path="private/conversation.pdf";
  assert.equal((await deliverOwnerMaterial(f.db,inbound,id(2),{env,fetchImpl:f.fetchImpl})).status,"blocked");assert.equal(f.downloads,0);assert.equal(f.fetches.length,0);
});
test("schema ACL and guards are explicitly service-only; no history rewrite",async()=>{
  const sql=await readFile(new URL("../supabase/migrations/20261002044903_owner_approved_materials_v1.sql",import.meta.url),"utf8");
  assert.match(sql,/unique\(respond_contact_id,stage_key,material_code\)/);assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/as restrictive for all to anon,authenticated/);assert.match(sql,/set local lock_timeout = '3s'/);
  assert.doesNotMatch(sql,/grant.*\bto\s+(anon|authenticated)\s*;/i);assert.doesNotMatch(sql,/update\s+public\.(owner_agent_v1|gv_respond|profiles)/i);
});
test("expired or invalid inbound window blocks extra material message",async()=>{
  for(const occurred_at of ["2000-01-01", "invalid", "2099-01-01"]){
    const f=fixture();const result=await deliverOwnerMaterial(f.db,{...inbound,occurred_at},id(2),{env,fetchImpl:f.fetchImpl});
    assert.equal(result.error_code,"material_messaging_window_closed");assert.equal(f.fetches.length,0);assert.equal(f.rpcs.length,0);
  }
});

// Load the real processor with synthetic dependency boundaries, not real SDKs/providers.
test("real Owner processor integrates guard + delivery, OFF preserves legacy without material IO",async()=>{
  const original=await readFile(new URL("../lib/agentsV2/processOwnerInbound.js",import.meta.url),"utf8");
  const stripped=original.replace(/^import .*;\n/gm,"").replace("export async function processOwnerInboundById","async function processOwnerInboundById");
  const factory=new Function("readRespondMessages","respondMessageTimestamp","sanitizeShadowText","createOwnerSession","getOwnerSession","fulfillOwnerActions","ownerOutput","safeAgentUsage","materialsEnabled","selectOwnerMaterial","guardOwnerMaterialResponse","deliverOwnerMaterial","fetch",stripped+"\nreturn processOwnerInboundById;");
  for(const active of [false,true]){
    const tables={owner_agent_v1_inbound_messages:[{...inbound,status:"captured"}],gv_respond_contact_snapshots:[],owner_agent_v1_runs:[],owner_agent_v1_auto_outbound:[]};let materialCalls=0,sent=[];
    const admin={from(name){let filters=[],patch,insert,one=false;const q={select(){return q;},eq(k,v){filters.push(x=>x[k]===v);return q;},lte(){return q;},gt(k,v){filters.push(x=>x[k]>v);return q;},order(){return q;},limit(){return q;},maybeSingle(){one=true;return q;},single(){one=true;return q;},update(p){patch=p;return q;},insert(p){insert={...p,id:id(2)};return q;},then(ok,fail){if(insert)tables[name].push(insert);const rows=tables[name].filter(x=>filters.every(f=>f(x)));if(patch)rows.forEach(x=>Object.assign(x,patch));return Promise.resolve({data:one?rows[0]||null:rows,error:null}).then(ok,fail);}};return q;}};
    const process=factory(async()=>({messages:[]}),()=>null,x=>({text:x}),async()=>({id:"synthetic"}),async()=>({id:"synthetic",status:"idle"}),async()=>{},async()=>"Aplica la garantía de 30 días",async()=>({}),materialsEnabled,selectOwnerMaterial,guardOwnerMaterialResponse,async(db,b,run)=>{materialCalls++;assert.equal(tables.owner_agent_v1_auto_outbound[0].status,"sent");assert.equal(run,id(2));return {status:"sent"};},async(_url,init)=>{sent.push(JSON.parse(init.body).message.text);return {ok:true,json:async()=>({messageId:123})};});
    const result=await process(admin,inbound.id,{env:{...env,OWNER_APPROVED_MATERIALS_V1_ENABLED:String(active)}});
    assert.equal(result.status,"sent");assert.equal(materialCalls,active?1:0);assert.equal(sent[0],active?rentalGuaranteeText():"Aplica la garantía de 30 días");assert.equal(tables.owner_agent_v1_runs[0].proposed_response,sent[0]);
  }
});
