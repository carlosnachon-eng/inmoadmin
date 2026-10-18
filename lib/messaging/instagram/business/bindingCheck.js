// Temporary read-only diagnostic: no sender, Graph, credentials or action journal calls.
import {businessConfig} from './config.js';
import {openRecipient,open,eventBinding} from './crypto.js';
export const TARGET_EVENT='05d762676e7866b7b538a34b1752157425b21ca536a02ac757c7410275c54d21';
export const DEADLINE=Date.parse('2026-10-19T02:27:08.193Z');
export function verifyCapturedBinding(c,row){
 if(!row||row.event_ref!==TARGET_EVENT)throw Error('denied');
 const e={...row,occurred_at:new Date(row.occurred_at).toISOString()};
 openRecipient(c,e);
 const content=open(c,'content',eventBinding(e),e.content_box);
 if(content.text!=='IGPROD-INBOUND-20261017-01 — Prueba controlada de recepción. No responder.')throw Error('denied');
 return true;
}
export function createBindingCheck({authorize,getDb,env=process.env,now=Date.now}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
  const fail=(code=403)=>res.status(code).json({status:'FAIL'});
  try{
   if(req.method!=='POST'||Object.keys(req.query||{}).length||!req.body||Array.isArray(req.body)||typeof req.body!=='object'||Object.keys(req.body).length)return fail();
   if(req.headers.origin!=='https://app.emporioinmobiliario.com.mx'||now()>=DEADLINE)return fail();
   const c=businessConfig(env);
   if(!c?.production||c.senderEnabled||c.connection!=='5f695ba8-eeed-4dd7-8b9d-88b7e3a1327b'||c.app!=='2918004201870607'||c.instagramApp!=='2370690620336933'||c.account!=='17841440384433670')return fail();
   const actor=await authorize(req);if(!actor?.active||actor.role_id!=='admin')return fail();
   const {data,error}=await getDb().rpc('ig_business_binding_check_input_v1',{p_actor:actor.id});
   if(error||!data)return fail();
   verifyCapturedBinding(c,data);
   return res.status(200).json({status:'PASS'});
  }catch{return fail();}
 };
}
