import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createInboxHandler} from '../lib/messaging/metaAdminInbox/api.js';
import {projectInboxMessage,projectInboxEpisodes,createInboxReader} from '../lib/messaging/metaAdminInbox/read.js';
const id='a0000000-0000-4000-8000-000000000001';
const res=()=>({setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
for(const actor of [null,{active:false,role_id:'admin'},{active:true,role_id:'sales'}])test('unauthorized role cannot invoke reader '+JSON.stringify(actor),async()=>{
 const r=res();await createInboxHandler({authorize:async()=>actor,reader:()=>assert.fail('read')})({method:'GET',query:{}},r);assert.equal(r.code,403);
});
test('no mutation method accepted',async()=>{const r=res();await createInboxHandler({authorize:()=>assert.fail('auth'),reader:()=>assert.fail('read')})({method:'POST'},r);assert.equal(r.code,405);});
test('forged entity query rejected',async()=>{const r=res();await createInboxHandler({authorize:async()=>({active:true,role_id:'admin'}),reader:()=>assert.fail('read')})({method:'GET',query:{property_id:id}},r);assert.equal(r.code,400);});
test('errors do not disclose private contents',async()=>{const r=res();await createInboxHandler({authorize:async()=>{throw Error('secret');}})({method:'GET'},r);assert.deepEqual(r.body,{error:'inbox_unavailable'});});
test('message projection excludes native IDs, tokens and URLs',()=>{
 const x=projectInboxMessage({message_ref:id,occurred_at:'2026-10-09T12:00:00Z',provenance:'customer_inbound',message_type:'image',media_reference_present:true,token:'secret',media_id:'secret',native_message_id:'secret',url:'secret'});
 assert.equal(x.attachment,'interpretation_pending');assert.equal(JSON.stringify(x).includes('secret'),false);
});
test('app echo never becomes human',()=>{const x=projectInboxMessage({message_ref:id,occurred_at:'2026-10-09T12:00:00Z',provenance:'business_outbound_unattributed',message_type:'text'});assert.equal(x.provenance,'business_outbound_unattributed');});
test('unsupported provenance is rejected',()=>assert.throws(()=>projectInboxMessage({message_ref:id,provenance:'human_confirmed'})));
test('mutated content hidden',()=>assert.equal(projectInboxMessage({message_ref:id,occurred_at:'2026-10-09T12:00:00Z',provenance:'customer_inbound',message_type:'text',text:'old content',mutated:true}).text,null));
test('historical media unavailable',()=>assert.equal(projectInboxMessage({message_ref:id,occurred_at:'2026-10-09T12:00:00Z',provenance:'customer_inbound',message_type:'image',media_reference_present:false}).attachment,'not_available'));
test('memory requires matched identity and matching scope',()=>{
 const identity={state:'matched',client_identity_id:id,reason:'exact_existing_canonical_phone'};
 const hash=createHash('sha256').update(JSON.stringify([id,identity.reason])).digest('hex');
 const context={state:'ready',property_ref:'property_'+'a'.repeat(16)};
 const episode={id:'episode_'+'a'.repeat(32),identityFingerprint:hash,scope:{property_ref:context.property_ref},topic:'agreement',status:'open',pending:'verification',version:1};
 assert.equal(projectInboxEpisodes([episode],context,identity).length,1);
 assert.equal(projectInboxEpisodes([episode],context,{state:'unmatched'}).length,0);
 assert.equal(projectInboxEpisodes([{...episode,scope:{property_ref:'property_'+'b'.repeat(16)}}],context,identity).length,0);
 assert.equal(projectInboxEpisodes([episode],{state:'ambiguous'},identity).length,0);
});
test('list excludes staff and private fields',async()=>{
 const db={rpc:async()=>({data:[{input_id:id,last_activity:'2026-10-09T12:00:00Z',identity_state:'unmatched',audience:'unknown',phone:'secret'},{input_id:id,audience:'internal'}]})};
 const rows=await createInboxReader({db}).list();assert.equal(rows.length,1);assert.equal(JSON.stringify(rows).includes('secret'),false);
});
test('unmatched detail never reads canonical tables or memory',async()=>{
 const now=Date.parse('2026-10-09T12:00:00Z');
 const s={input:{id,waba_id:'1297760461811288',phone_number_id:'1198305790026665',subject_ref:'a'.repeat(64),key_tag:'b'.repeat(64)},identity:{state:'unmatched'},checked_at:new Date(now).toISOString(),subject_nodes:[],echo_roots:[]};
 const proof={input_id:id,checked_at:s.checked_at,native_verified:true,scope_verified:true,subject_ref:s.input.subject_ref,key_tag:s.input.key_tag,audience:'unknown'};
 const db={from:()=>assert.fail('private read'),rpc:async name=>{if(name==='meta_admin_manual_attention_v1')return {data:false};if(name==='meta_admin_shadow_snapshot_v1')return {data:structuredClone(s)};if(name==='meta_admin_memory_evidence_v1')return {data:proof};if(name==='meta_admin_inbox_history_v1')return {data:[]};assert.fail(name);}};
 const result=await createInboxReader({db,now:()=>now}).detail(id);assert.equal(result.context.state,'blocked');assert.equal(result.manual_send.enabled,false);
});
test('SQL uses native evidence and restricted RPCs, no table writes',async()=>{
 const sql=await readFile(new URL('../scripts/sql/meta-admin-inbox-read.sql',import.meta.url),'utf8');
 assert.match(sql,/se.key_tag=t.key_tag/);assert.match(sql,/se.subject_ref=t.sender_ref/);
 assert.doesNotMatch(sql,/\b(insert into|update |delete from)\b/i);assert.doesNotMatch(sql,/grant .* to (anon|authenticated)/i);
 assert.match(sql,/from public,anon,authenticated,service_role/);
});
