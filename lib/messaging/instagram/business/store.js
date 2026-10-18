// The client passed here is server-only service role; browsers cannot execute
// any of these RPCs. Each human operation rechecks public.profiles in SQL.
export function createBusinessStore(db,connection){
 const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw Error('business_store_unavailable');return data;};
 const token=(op,data={})=>rpc('ig_business_token_v1',{p_connection:connection,p_op:op,p_data:data});
 const normalize=e=>e?{...e,occurred_at:new Date(e.occurred_at).toISOString()}:null;
 return {
  authorizedOperator:actor=>rpc('ig_business_operator_v1',{p_connection:connection,p_actor:actor}),
  capture:p=>rpc('ig_business_capture_v1',{p_connection:connection,p_receipt:p.receipt_ref,p_rows:p.rows}),
  loadInput:async(c,input,actor)=>{if(c!==connection)throw Error('scope');return normalize(await rpc('ig_business_input_v1',{p_connection:c,p_input:input,p_actor:actor}));},
  reserveAndPause:a=>rpc('ig_business_reserve_v1',{p_args:a}),
  start:a=>rpc('ig_business_start_v1',{p_action:a.action,p_lease:a.lease}),
  finish:(a,o)=>rpc('ig_business_finish_v1',{p_action:a.action,p_lease:a.lease,p_outcome:o}),
  threads:actor=>rpc('ig_business_threads_v1',{p_connection:connection,p_actor:actor}),
  history:async(thread,actor)=>{const r=await rpc('ig_business_history_v1',{p_connection:connection,p_thread:thread,p_actor:actor});return r?{rows:r.rows.map(normalize),tombstones:new Set(r.tombstones)}:null;},
  alias:(thread,actor,op,alias=null)=>rpc('ig_business_thread_alias_v1',{p_connection:connection,p_thread:thread,p_actor:actor,p_op:op,p_alias:alias}),
  contact:(thread,actor,op,phone=null,email=null)=>rpc('ig_business_thread_contact_v1',{p_connection:connection,p_thread:thread,p_actor:actor,p_op:op,p_phone:phone,p_email:email}),
  importHistory:(actor,rows)=>rpc('ig_business_import_history_v1',{p_connection:connection,p_actor:actor,p_rows:rows}),
  outboundMedia:async(actor,path)=>{
   if(typeof actor!=='string'||typeof path!=='string'||!path.startsWith(actor+'/'))throw Error('media_scope_denied');
   const bucket=db.storage.from('instagram-business-outbound');
   const downloaded=await bucket.download(path);if(downloaded.error||!downloaded.data)throw Error('media_unavailable');
   const buffer=Buffer.from(await downloaded.data.arrayBuffer());
   if(!buffer.length||buffer.length>26214400)throw Error('media_size_denied');
   const signed=await bucket.createSignedUrl(path,600);if(signed.error||!signed.data?.signedUrl)throw Error('media_sign_denied');
   return{buffer,url:signed.data.signedUrl};
  },
  createState:d=>token('state_create',d),consumeState:d=>token('state_consume',d),saveCredential:d=>token('save',d),
  loadCredential:async()=>{const r=await token('load');if(r)for(const f of ['issued_at','expires_at','verified_at'])r[f]=new Date(r[f]).toISOString();return r;},
  claimMaintenance:(generation,lease)=>token('claim',{generation,lease}),
  finishMaintenance:(generation,lease,next)=>token('finish',{generation,lease,next}),
  failMaintenance:(generation,lease)=>token('fail',{generation,lease}),
 };
}
