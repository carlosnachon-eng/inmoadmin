import {createFacebookCommentReceiver} from '../../../lib/messaging/commentAgent/facebookWebReceiver.js';
// Prepared only: separate function/URL, never replace facebook-messenger-dev.
const names=['ENABLED','CONNECTION_ID','APP_ID','PAGE_ID','APP_SECRET','VERIFY_TOKEN','INDEX_KEY','DATA_KEY','TOKEN_KEY'];
Deno.serve(createFacebookCommentReceiver({
 env:()=>({APP_ENV:'development',VERCEL_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
  FACEBOOK_COMMENTS_DEV_ENABLED:Deno.env.get('FACEBOOK_COMMENTS_DEV_ENABLED'),
  FACEBOOK_MESSENGER_MANUAL_SEND_ENABLED:'false',
  ...Object.fromEntries(names.map(n=>['FACEBOOK_MESSENGER_'+n,Deno.env.get('FACEBOOK_MESSENGER_'+n)]))}),
 capture:async(c,row)=>{
  if(Deno.env.get('SUPABASE_URL')!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')throw Error('environment_denied');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key)throw Error('configuration');
  const r=await fetch('https://hjfwjnejbcpmknvfpdcq.supabase.co/rest/v1/rpc/comment_review_v1',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(3500),
   headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${key}`},
   body:JSON.stringify({p_platform:'facebook',p_connection:c.connection,p_actor:null,p_op:'capture',p_data:row})});
  if(!r.ok)throw Error('persistence');return r.json();
 },diagnostic:record=>console.info('facebook_comments_dev',record)
}));
