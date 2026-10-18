import {messengerConfig} from './config.js';
import {recipient} from './crypto.js';
import {pageToken} from './manual.js';
import {sameOriginAdminRequest} from '../../../shadow/identityBootstrap.js';

// Temporary, reviewed canary scope. Not a sender grant or a general admin bypass.
export const CANARY=Object.freeze({
 connection:'d23565dd-2b02-44fe-81aa-bd1fb6d772d9',
 actor:'28e979dd-dae5-416a-a948-fff1c39f22bb',
 input:'d40d09c174aa3290eff76e066585b287cd00f9f711f478bf5f033f88a74d1fc3',
 thread:'ae308f4977ce864bea4f9dbae03b2ec5094b5bbbfe85e9d80eecd9cdfcc46a66',
 until:Date.parse('2026-10-19T19:37:36.032Z'),
});
export function checkCanary(c,actor,e,k,{scope=CANARY,now=Date.now()}={}){
 let code='scope_denied';
 try{
  if(!c||c.senderEnabled||c.connection!==scope.connection||actor?.id!==scope.actor||!actor.active||actor.role_id!=='admin'||now>=scope.until)throw Error();
  if(!e||e.event_ref!==scope.input||e.thread_ref!==scope.thread)throw Error();
  code='window_denied';const age=now-Date.parse(e.occurred_at);
  if(!Number.isFinite(age)||age<0||age>=23*3600000)throw Error();
  code='recipient_binding_denied';recipient(c,e);
  code='credential_denied';pageToken(c,k,now);
  return {status:'PASS'};
 }catch{return {status:'FAIL',code};}
}
export function createMessengerPreflight({authorize,getDb,env=()=>process.env,scope=CANARY,now=Date.now}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  let code='request_denied';
  try{
   if(req.method!=='POST'||!req.body||Object.keys(req.body).length||!sameOriginAdminRequest(req))return res.status(403).json({status:'FAIL',code});
   code='operator_denied';const actor=await authorize(req);
   if(actor?.id!==scope.actor||!actor.active||actor.role_id!=='admin')return res.status(403).json({status:'FAIL',code});
   code='scope_denied';const c=messengerConfig(env());
   if(!c||c.senderEnabled||c.connection!==scope.connection||now()>=scope.until)return res.status(403).json({status:'FAIL',code});
   code='read_denied';const db=await getDb();
   const {data,error}=await db.rpc('fb_messenger_canary_preflight_v1',{p_connection:c.connection,p_actor:actor.id,p_input:scope.input,p_thread:scope.thread});
   if(error||!data)throw Error();
   return res.status(200).json(checkCanary(c,actor,data.event,data.credential,{scope,now:now()}));
  }catch{return res.status(403).json({status:'FAIL',code});}
 };
}
