import {createShadowOnceSupabaseStore} from './shadowOnceSupabase.js';
export function createControlledOutboundStore(client){
 const call=async(name,args)=>{const r=await client.rpc(name,args);if(r.error)throw Error('outbound_journal_unavailable');return r.data;};
 const exact=async(name,args)=>{if(await call(name,args)!==true)throw Error('outbound_transition_rejected');};
 return {
  snapshot:createShadowOnceSupabaseStore(client).snapshot,
  load:id=>call('meta_admin_outbound_load_v1',{p_input_id:id}),
  reserve:a=>call('meta_admin_outbound_reserve_v1',{p_input_id:a.inputId,p_token:a.token,p_fingerprint:a.fingerprint,p_proposal_hash:a.proposalHash,p_context_hash:a.contextHash}),
  start:(id,token)=>call('meta_admin_outbound_start_v1',{p_input_id:id,p_token:token}),
  finish:(id,token,status,wamid)=>exact('meta_admin_outbound_finish_v1',{p_input_id:id,p_token:token,p_status:status,p_wamid:wamid}),
  review:(id,reason)=>call('meta_admin_outbound_review_v1',{p_input_id:id,p_reason:reason}),
  status:id=>call('meta_admin_outbound_status_v1',{p_input_id:id})
 };
}
