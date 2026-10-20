// Local-only fake RPC store; no credentials, network client, or database writes.
import {createInboxReader} from '../lib/messaging/metaAdminInbox/read.js';
import {createWhatsAppAdminHandler} from '../lib/messaging/whatsappAdmin/inbox.js';
export const uuid=n=>`f2530000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function syntheticQA(){
 const state={mode:'normal',role:'admin',revision:0,rpcs:[],writes:0};
 const contacts=[1,2,3].map(n=>({id:uuid(n),state:['matched','unmatched','ambiguous'][n-1],n}));
 const history=c=>[0,1,2].map((m)=>({message_ref:uuid(c.n*10+m),occurred_at:`2026-10-${17+c.n}T12:0${m}:00Z`,
  provenance:m===1?'business_outbound_unattributed':'customer_inbound',message_type:m===2&&c.n===2?'image':'text',
  text:m===1?null:`Contacto sintético ${c.n} · mensaje ${m+1}${state.revision&&c.n===3&&m===2?' · actualizado':''}`,
  media_reference_present:m===2&&c.n===2}));
 const db={from(){throw Error('canonical access forbidden');},async rpc(name,args){
  state.rpcs.push(name);if(state.mode==='error')return {error:{message:'synthetic unavailable'}};
  if(name==='meta_admin_inbox_list_v1')return {data:state.mode==='empty'?[]:contacts.toReversed().map(c=>({input_id:c.id,identity_state:c.state,last_activity:history(c).at(-1).occurred_at,audience:'external_verified'}))};
  const c=contacts.find(c=>c.id===args.p_input_id);if(!c)return {data:null};
  const input={id:c.id,waba_id:'1297760461811288',phone_number_id:'1198305790026665',subject_ref:String(c.n).repeat(64),key_tag:'b'.repeat(64)};
  if(name==='meta_admin_shadow_snapshot_v1')return {data:{input,identity:{state:c.state,client_identity_id:c.id},checked_at:new Date().toISOString(),subject_nodes:[],echo_roots:[]}};
  if(name==='meta_admin_manual_attention_v1')return {data:false};
  if(name==='meta_admin_memory_evidence_v1')return {data:{input_id:c.id,checked_at:new Date().toISOString(),native_verified:true,scope_verified:true,subject_ref:input.subject_ref,key_tag:input.key_tag,audience:'external_verified'}};
  if(name==='meta_admin_inbox_history_v1')return {data:history(c)};
  throw Error('Non-read RPC forbidden: '+name);
 }};
 const handler=createWhatsAppAdminHandler({allowed:()=>true,authorize:async()=>({active:true,role_id:state.role}),reader:()=>createInboxReader({db,includeContext:false})});
 async function request(query,method='GET'){
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method,query},res);return res;
 }
 return {state,request,contacts};
}
