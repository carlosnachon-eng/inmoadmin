import {createWebReceiver} from '../../../lib/messaging/facebook/messenger/webReceiver.js';

const names=['ENABLED','CONNECTION_ID','APP_ID','PAGE_ID','APP_SECRET','VERIFY_TOKEN','INDEX_KEY','DATA_KEY','TOKEN_KEY'];
Deno.serve(createWebReceiver({
 env:()=>({APP_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
  FACEBOOK_MESSENGER_MANUAL_SEND_ENABLED:'false',
  ...Object.fromEntries(names.map(name=>['FACEBOOK_MESSENGER_'+name,Deno.env.get('FACEBOOK_MESSENGER_'+name)]))}),
 capture:async(c,rows)=>{
  // Fixed DEV target, service credential stays inside the runtime.
  if(Deno.env.get('SUPABASE_URL')!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')throw Error('environment_denied');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key)throw Error('db_unavailable');
  const response=await fetch('https://hjfwjnejbcpmknvfpdcq.supabase.co/rest/v1/rpc/fb_messenger_capture_v1',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(3500),
   headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${key}`},
   body:JSON.stringify({p_connection:c.connection,p_app:c.app,p_page:c.page,p_rows:rows})});
  if(!response.ok)throw Error('persistence_unavailable');return await response.json();
 },diagnostic:record=>console.info('messenger_dev',record)
}));
