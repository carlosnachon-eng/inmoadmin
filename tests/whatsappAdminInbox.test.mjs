import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWhatsAppAdminHandler,whatsappAdminPreviewAllowed} from '../lib/messaging/whatsappAdmin/inbox.js';
import {createInboxReader} from '../lib/messaging/metaAdminInbox/read.js';
import {validateWhatsAppAdminList,whatsappAdminListMessage} from '../lib/messaging/whatsappAdmin/listState.js';
const id='a0000000-0000-4000-8000-000000000001';
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const actor={active:true,role_id:'admin'};
const detail={input_id:id,identity_state:'unmatched',history_truncated:false,messages:[
 {message_ref:id,text:'fixture',type:'text',occurred_at:'2026-10-20T12:00:00Z',provenance:'customer_inbound'}]};
const make=(overrides={})=>createWhatsAppAdminHandler({allowed:()=>true,authorize:async()=>actor,
 reader:()=>({list:async()=>[{input_id:id,label:'Contacto',last_activity:'2026-10-20T12:00:00Z',identity_state:'unmatched'}],
 detail:async()=>structuredClone(detail)}),...overrides});
test('DEV host and explicit Preview required; production and missing config denied',()=>{
 const env={VERCEL_ENV:'preview',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co'};
 assert.equal(whatsappAdminPreviewAllowed(env),true);
 for(const change of [{VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:'bad'}])
  assert.equal(whatsappAdminPreviewAllowed({...env,...change}),false);
});
for(const role of ['asesor','gerente_ventas','juridico',null])test('role denied: '+role,async()=>{
 const res=response();await make({authorize:async()=>role?{active:true,role_id:role}:null,reader:()=>assert.fail('read')})({method:'GET',query:{op:'threads'}},res);
 assert.equal(res.code,403);
});
for(const method of ['POST','PUT','DELETE','PATCH'])test(method+' cannot mutate',async()=>{
 const res=response();await make({reader:()=>assert.fail('read')})({method},res);assert.equal(res.code,405);
});
test('disabled environment denies before auth or DB',async()=>{
 const res=response();await make({allowed:()=>false,authorize:()=>assert.fail('auth')})({method:'GET'},res);assert.equal(res.code,404);
});
for(const query of [{op:'send'},{op:'history',thread:id,waba_id:'sales'},{op:['threads']},{op:'history'},{op:'history',thread:id,before:'2026-01-01'}])
 test('caller cannot choose channel/scope/operation '+JSON.stringify(query),async()=>{
  const res=response();await make({reader:()=>assert.fail('read')})({method:'GET',query},res);assert.equal(res.code,400);
 });
test('list preview uses authorized history and contains no private context',async()=>{
 const res=response();await make()({method:'GET',query:{op:'threads'}},res);
 assert.equal(res.code,200);assert.equal(res.body.rows[0].preview,'fixture');
 assert.deepEqual(res.body.status,{mode:'read_only',connection:'not_certified',sender:false,onboarding:false,
  data_source:{environment:'dev',project_ref:'hjfwjnejbcpmknvfpdcq',scope:'whatsapp_administracion'}});
});
test('empty database produces a valid authorized empty list, never reads history',async()=>{
 const res=response();await make({reader:()=>({list:async()=>[],detail:()=>assert.fail('history')})})({method:'GET',query:{op:'threads'}},res);
 assert.equal(res.code,200);assert.deepEqual(validateWhatsAppAdminList(res.body).rows,[]);
 assert.match(whatsappAdminListMessage({phase:'ready',count:0}),/Lectura autorizada completada en DEV/);
});
test('list RPC failure is unavailable, not empty success',async()=>{
 const res=response();await make({reader:()=>({list:async()=>{throw Error('private sql');}})})({method:'GET',query:{op:'threads'}},res);
 assert.equal(res.code,503);assert.equal(res.body.rows,undefined);
 assert.match(whatsappAdminListMessage({phase:'error',filtered:true}),/No se puede determinar/);
});
test('malformed HTTP 200 cannot silently become zero conversations',()=>{
 for(const result of [null,{}, {rows:null}, {rows:{}}, {rows:[]}, {rows:[],status:{sender:true}}])
  assert.throws(()=>validateWhatsAppAdminList(result));
 assert.match(whatsappAdminListMessage({phase:'loading'}),/Consultando/);
 assert.match(whatsappAdminListMessage({phase:'ready',filtered:true,count:2}),/filtros/);
});
test('RPC jsonb [] is empty; object/null payloads are errors, not zero',async()=>{
 assert.deepEqual(await createInboxReader({db:{rpc:async()=>({data:[]})},includeContext:false}).list(),[]);
 for(const data of [null,{},'[]'])await assert.rejects(createInboxReader({db:{rpc:async()=>({data})}}).list());
});
test('duplicate history is rendered once; conflicting evidence fails closed',async()=>{
 for(const conflict of [false,true]){
  const res=response();await make({reader:()=>({detail:async()=>({...detail,messages:[...detail.messages,
   {...detail.messages[0],text:conflict?'conflict':'fixture'}]})})})({method:'GET',query:{op:'history',thread:id}},res);
  assert.equal(res.code,conflict?503:200);if(!conflict)assert.equal(res.body.rows.length,1);
 }
});
test('refresh reflects changed state without mutations or stale body',async()=>{
 let calls=0;const handler=make({reader:()=>({detail:async()=>({...detail,messages:[{...detail.messages[0],
  text:++calls===1?'fixture':null,modified:calls>1}]})})});
 const first=response(),second=response();
 await handler({method:'GET',query:{op:'history',thread:id}},first);
 await handler({method:'GET',query:{op:'history',thread:id}},second);
 assert.equal(first.body.rows[0].text,'fixture');assert.equal(second.body.rows[0].text,null);
 assert.equal(second.body.status.sender,false);
});
test('safe errors never expose underlying SQL or secrets',async()=>{
 const res=response();await make({reader:()=>{throw Error('private payload');}})({method:'GET',query:{op:'threads'}},res);
 assert.deepEqual(res.body,{error:'stored_history_unavailable'});
});
for(const invalid of ['sales','subject','stale','internal',null])test('real reader evidence gate '+invalid,async()=>{
 const now=Date.parse('2026-10-20T12:00:00Z');
 const s={input:{id,waba_id:invalid==='sales'?'other':'1297760461811288',phone_number_id:'1198305790026665',
  subject_ref:'a'.repeat(64),key_tag:'b'.repeat(64)},identity:{state:'matched',client_identity_id:id},
  checked_at:new Date(invalid==='stale'?now-10000:now).toISOString(),subject_nodes:[],echo_roots:[]};
 const proof={input_id:id,checked_at:s.checked_at,native_verified:true,scope_verified:true,
  subject_ref:invalid==='subject'?'different':s.input.subject_ref,key_tag:s.input.key_tag,audience:invalid==='internal'?'internal':'external_verified'};
 const db={from:()=>assert.fail('context'),rpc:async name=>{
  if(name==='meta_admin_manual_attention_v1')return {data:false};
  if(name==='meta_admin_shadow_snapshot_v1')return {data:s};
  if(name==='meta_admin_memory_evidence_v1')return {data:proof};
  if(name==='meta_admin_inbox_history_v1')return {data:[]};
  assert.fail('Unexpected RPC: '+name);
 }};
 const promise=createInboxReader({db,now:()=>now,includeContext:false}).detail(id);
 if(invalid)await assert.rejects(promise);else assert.equal((await promise).messages.length,0);
});
test('single Inbox explicit adapter; no writes, onboarding or composer in WA component',async()=>{
 const ui=await readFile(new URL('../components/WhatsAppAdminConversation.js',import.meta.url),'utf8');
 const inbox=await readFile(new URL('../components/CommercialInbox.js',import.meta.url),'utf8');
 const api=await readFile(new URL('../pages/api/operaciones/whatsapp-admin-inbox.js',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/<textarea|onSubmit|method:\s*['"]POST|window\.FB|graph\.facebook/);
 assert.match(ui,/<details>/);assert.match(ui,/@media\(max-width:760px\)/);
 assert.match(inbox,/selected.channel==='whatsapp_admin'/);
 assert.match(inbox,/filter==='all'&&whatsappAdminAvailable&&waList.phase==='error'/);
 assert.match(inbox,/channel==='whatsapp_admin'\?'whatsapp-admin-inbox'/);
 assert.match(api,/includeContext:false/);
 assert.doesNotMatch(api,/process\.env\.\w*TOKEN|sendText|dispatch|claim/i);
});
