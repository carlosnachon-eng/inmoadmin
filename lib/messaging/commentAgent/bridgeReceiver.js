import {verifyBridge,DEV_URL} from './bridge.js';
import {businessConfig} from '../instagram/business/config.js';
import * as crypto from '../instagram/business/crypto.js';
import {projectReviews} from './reviewProjection.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Only three fixed reads. No arbitrary RPC, decrypt, credential export or Meta transport.
export function createBridgeReceiver({env=process.env,fetchImpl=fetch}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private,no-store');
  let stage='bridge_authorization';
  try{
   const token=verifyBridge(req,env);
   if(!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('configuration');
   const read=async(path,options={})=>{
    const r=await fetchImpl(DEV_URL+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('upstream');return r.json();
   };
   // Network-verified Supabase identity, never decoded JWT/user_metadata authorization.
   const user=await read('/auth/v1/user');
   if(!UUID.test(user?.id||''))throw Error('identity');
   const profiles=await read('/rest/v1/profiles?select=id,role_id,active&id=eq.'+user.id);
   const actor=Array.isArray(profiles)&&profiles.length===1?profiles[0]:null;
   if(actor?.id!==user.id||actor.active!==true||!['admin','gerente_ventas'].includes(actor.role_id))throw Error('role');
   stage='configuration';const c=businessConfig(env);
   if(!c||c.senderEnabled)throw Error('configuration');
   stage='journal_read';
   const rows=await read('/rest/v1/rpc/comment_review_v1',{method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify({p_platform:'instagram',p_connection:c.connection,p_actor:actor.id,p_op:'list',p_data:{}})});
   stage='projection';
   return res.status(200).json({...projectReviews(rows,crypto,c),read_only:true});
  }catch{
   return res.status(stage==='bridge_authorization'?403:503).json({status:'review_unavailable',diagnostic:{stage,code:'bridge_read_denied'}});
  }
 };
}
