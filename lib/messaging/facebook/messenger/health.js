import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {messengerConfig} from './config.js';
import {open,seal} from './crypto.js';
import {inspectPageToken} from './provisioning.js';

const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
// Never relay provider text, URLs, IDs, credentials or arbitrary exception messages.
const stages=new Set(['credential_missing','credential_binding','metadata_shape','token_invalid','app_binding','page_binding','token_type','scopes_shape','permissions','expiry_unknown','token_expired','granular_scopes_shape','permission_target','token_shape','introspection','page_identity','subscriptions','subscriptions_shape','subscriptions_ambiguous','subscriptions_pagination','subscriptions_missing','verified']);
export async function runMessengerHealth(c,{db,fetchImpl,now=Date.now}){
 const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error('store_unavailable');return r.data;};
 const run=randomUUID();
 const previous=await rpc('fb_messenger_health_begin_v1',{p_connection:c.connection,p_run:run});
 if(!previous)return {ok:true,status:'not_due_or_running'};
 if(previous.health_error)return {ok:false,status:'unhealthy_sender_off',stage:'credential_missing',dispatches:0};
 let result={ok:false,stage:'credential_binding'},token;
 try{
  if(previous.app_id!==c.app||previous.page_id!==c.page)throw Error('binding');
  token=open(c,'token',[previous.generation,previous.valid_until],previous.token_box);
  result=await inspectPageToken(c,token,{fetchImpl,now:now()});
  if(result.ok&&(!result.inbound_ready||!result.echo_ready))result={ok:false,stage:'subscriptions_missing'};
 }catch{result={ok:false,stage:'credential_binding'};}
 const stage=stages.has(result.stage)?result.stage:'credential_binding';
 const args={ok:result.ok===true,stage,expected_generation:previous.generation,
  http_status:Number.isSafeInteger(result.http_status)?result.http_status:null,
  code:Number.isSafeInteger(result.code)?result.code:null,subcode:Number.isSafeInteger(result.subcode)?result.subcode:null};
 if(result.ok)Object.assign(args,{generation:previous.generation+1,scopes:result.scopes,
  verified_at:result.verified_at,valid_until:result.valid_until,
  token_box:seal(c,'token',[previous.generation+1,result.valid_until],token),metadata:result});
 const saved=await rpc('fb_messenger_health_finish_v1',{p_connection:c.connection,p_run:run,p_args:args});
 if(saved!==true)return {ok:false,status:'health_conflict'};
 return {ok:result.ok===true,status:result.ok?'healthy':'unhealthy_sender_off',stage,
  ...(result.ok?{verified_at:result.verified_at,valid_until:result.valid_until}:{}),dispatches:0};
}
export function createMessengerHealthApi({getDb,env=()=>process.env,fetchImpl}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,status:'method_denied'});
  const e=env();
  if(!e.CRON_SECRET||e.CRON_SECRET.length<16||!equal(req.headers?.authorization,`Bearer ${e.CRON_SECRET}`))return res.status(401).json({ok:false,status:'unauthorized'});
  if(e.FACEBOOK_MESSENGER_HEALTH_ENABLED!=='true')return res.status(200).json({ok:true,status:'disabled'});
  try{
   const c=messengerConfig(e);if(!c)return res.status(200).json({ok:true,status:'disabled'});
   const r=await runMessengerHealth(c,{db:await getDb(),fetchImpl});
   return res.status(r.ok?200:503).json(r);
  }catch{return res.status(503).json({ok:false,status:'health_unavailable'});}
 };
}
