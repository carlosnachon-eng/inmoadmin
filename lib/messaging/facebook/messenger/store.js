// Service-only RPC boundary. Human operations recheck profiles + exact grants in SQL.
export function messengerStore(db,connection,config) {
  const rpc=async(name,args) => {
    const {data,error}=await db.rpc(name,args);
    if (error) throw Error('messenger_store_unavailable');
    return data;
  };
  return {
    capture:rows => rpc('fb_messenger_capture_v1',{p_connection:connection,p_app:config?.app,p_page:config?.page,p_rows:rows}),
    input:(actor,input) => rpc('fb_messenger_read_v1',{p_connection:connection,p_actor:actor,p_input:input}),
    credential:() => rpc('fb_messenger_credential_v1',{p_connection:connection}),
    reserve:a => rpc('fb_messenger_reserve_v1',{p_args:a}),
    start:a => rpc('fb_messenger_start_v1',{p_connection:connection,p_action:a.action,p_lease:a.lease}),
    finish:(a,outcome) => rpc('fb_messenger_finish_v1',{p_connection:connection,p_action:a.action,p_lease:a.lease,p_outcome:outcome}),
  };
}
