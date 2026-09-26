import test from 'node:test'
import assert from 'node:assert/strict'
import { polizaInternalAuth, externalInvestigationGate } from '../lib/server/polizaInternalAuth.mjs'
import { externalReviewHandler } from '../lib/server/externalReview.mjs'
import { publicPayment } from '../lib/server/externalPayment.mjs'
const id='11111111-1111-4111-8111-111111111111'
const req={headers:{authorization:'Bearer qa-session'}}
function dbFixture(overrides={}) {
 const tables={profiles:{id,full_name:'I2B-QA',role_id:'juridico',active:true,roles:{es_externo:false}},permisos_modulo:{puede_ver:true,puede_editar:true},blindaje_external_cases:{id,status:'payment_validated'},blindaje_investigation_payments:{id,case_id:id,status:'validated',proof_storage_path:`cases/${id}/investigation/${id}/${id}.pdf`,proof_original_name:'QA.pdf',proof_content_type:'application/pdf'},blindaje_investigation_ledger_entries:{poliza_caja_id:id},poliza_caja:{id,tipo:'ingreso',concepto:'investigacion',monto:1000},...overrides}
 const calls=[]
 return {tables,calls,auth:{getUser:async token=>token==='qa-session'?{data:{user:{id}}}:{error:{message:'secret'}}},
 from(table){let single=false;const q={select(){return q},eq(){return q},order(){return q},maybeSingle(){single=true;return q},then(resolve,reject){return Promise.resolve({data:single?tables[table]:Array.isArray(tables[table])?tables[table]:[tables[table]]}).then(resolve,reject)}};return q},
 rpc:async (name,args)=>{calls.push({name,args});return {data:'validated'}},storage:{from(){return {createSignedUrl:async(path,seconds)=>{calls.push({path,seconds});return {data:{signedUrl:'https://qa.invalid/signed'}}}}}}}
}
async function endpoint(kind,db,body={},request=req,enabled=true){let status,payload;const headers={};await externalReviewHandler(kind,()=>db,()=>enabled)({...request,method:kind==='list'?'GET':'POST',body},{setHeader(k,v){headers[k]=v},status(v){status=v;return this},json(v){payload=v}});return {status,payload,headers}}
for (const [label,overrides,status] of [
 ['missing profile',{profiles:null},403],['inactive',{profiles:{active:false}},403],['external',{profiles:{active:true,roles:{es_externo:true}}},403],['unknown role',{profiles:{active:true,roles:null}},403],['read-only',{permisos_modulo:{puede_ver:true,puede_editar:false}},403],['editor',{},undefined],['admin',{profiles:{id,role_id:'admin',roles:{es_externo:false}}},undefined],
]) test(`server auth edit ${label}`,async()=>assert.equal((await polizaInternalAuth(dbFixture(overrides),req,true)).status,status))
test('missing/invalid session deny before mutation',async()=>{for(const r of [{headers:{}},{headers:{authorization:'Bearer bad'}}]){const db=dbFixture();assert.equal((await endpoint('review',db,{payment_id:id,action:'validate'},r)).status,401);assert.equal(db.calls.length,0)}})
test('read-only can read but cannot review; actor cannot be supplied',async()=>{const db=dbFixture({permisos_modulo:{puede_ver:true,puede_editar:false},blindaje_external_cases:[]});assert.equal((await endpoint('list',db)).status,200);assert.equal((await endpoint('review',db,{payment_id:id,action:'validate'})).status,403);assert.equal((await endpoint('review',dbFixture(),{payment_id:id,action:'validate',p_actor_id:id})).status,400)})
test('review uses verified actor; flag OFF makes no DB calls',async()=>{const db=dbFixture();assert.equal((await endpoint('review',db,{payment_id:id,action:'validate'})).status,200);assert.equal(db.calls[0].args.p_actor_id,id);assert.equal(db.calls[0].args.p_actor_label,'I2B-QA');assert.equal((await endpoint('list',null,{},req,false)).status,404)})
test('public reasons bounded and required',async()=>{for(const reason of ['', 'ab','x'.repeat(301)]) assert.equal((await endpoint('review',dbFixture(),{payment_id:id,action:'reject',rejection_reason:reason})).status,400)})
test('proof signed for 60 seconds and refuses arbitrary paths',async()=>{const db=dbFixture();const r=await endpoint('proof',db,{payment_id:id});assert.deepEqual(r.payload,{url:'https://qa.invalid/signed',original_name:'QA.pdf',content_type:'application/pdf'});assert.equal(db.calls[0].seconds,60);for(const path of ['private/another.pdf',`cases/${id}/investigation/${id}/../../other.pdf`]){const bad=dbFixture({blindaje_investigation_payments:{id,case_id:id,proof_storage_path:path}});assert.equal((await endpoint('proof',bad,{payment_id:id})).status,404);assert.equal(bad.calls.length,0)}})
for(const status of ['pending','proof_received','rejected'])test(`analysis gate denies ${status}`,async()=>assert.equal((await externalInvestigationGate(dbFixture({blindaje_investigation_payments:{id,status}}),req,id)).status,409))
test('analysis requires auth/edit/validated case/ledger/real accounting',async()=>{assert.equal((await externalInvestigationGate(dbFixture(),{headers:{}},id)).status,403);for(const overrides of [{blindaje_external_cases:{status:'proof_received'}},{blindaje_investigation_ledger_entries:null},{poliza_caja:{tipo:'egreso'}},{permisos_modulo:{puede_ver:true,puede_editar:false}}])assert.ok((await externalInvestigationGate(dbFixture(overrides),req,id)).error);assert.equal((await externalInvestigationGate(dbFixture(),req,id)).error,undefined)})
for(const status of ['pending','proof_received','validated','rejected'])test(`public ${status} exact projection`,()=>{const result=publicPayment({externalCase:{folio:'QA',id},payment:{status,rejection_reason:'Motivo neutral.',validated_by:id,rejected_by:id,payer_name:'secret',proof_storage_path:'secret'}},{banco:'QA'});assert.deepEqual(Object.keys(result).sort(),['folio','amount','currency','status','bank',...(status==='rejected'?['rejection_reason']:[])].sort())})

test('actual analysis endpoint gates only external initial requests, before audit or analysis', async () => {
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs')
 const require=createRequire(import.meta.url),{transform}=require('next/dist/build/swc')
 const {code}=await transform(readFileSync(new URL('../pages/api/analizar-solicitud.js',import.meta.url),'utf8'),{filename:'analizar-solicitud.js',jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}})
 for(const origin of ['b2c','partner','emporio',null]) {
  const db=dbFixture(),from=db.from.bind(db);let writes=0
  db.from=table=>{if(table!=='solicitudes_inquilino')return from(table);let update=false;const q={select(){return q},eq(){return q},single(){return q},update(){update=true;return q},then(resolve,reject){if(update)writes++;return Promise.resolve({data:update?null:{origen_operacion:origin,nombre_completo:'I2B-QA'}}).then(resolve,reject)}};return q}
  const module={exports:{}};new Function('require','module','exports',code)(name=>name==='@supabase/supabase-js'?{createClient:()=>db}:name.includes('polizaInternalAuth')?{externalInvestigationGate}:require(name),module,module.exports)
  let status;await module.exports.default({method:'POST',headers:{},body:{solicitud_id:id}},{status(v){status=v;return this},json(){}})
  assert.equal(status,['b2c','partner'].includes(origin)?403:200)
  assert.equal(writes,['b2c','partner'].includes(origin)?0:1)
 }
})
