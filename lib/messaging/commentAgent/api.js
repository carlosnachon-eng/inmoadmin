import {reviewBatch} from './decision.js';
export const commentObservationAllowed=env=>['preview','development'].includes(env.VERCEL_ENV)
 &&env.NEXT_PUBLIC_SUPABASE_URL==='https://hjfwjnejbcpmknvfpdcq.supabase.co';
export function createCommentObservationApi({authorize,loadInstagram,allowed}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(!allowed())return res.status(404).json({error:'observation_disabled'});
  if(req.method!=='GET')return res.status(405).json({error:'observation_only'});
  try{
   const actor=await authorize(req);
   if(!actor?.active||!['admin','gerente_ventas'].includes(actor.role_id))return res.status(403).json({error:'forbidden'});
   if(Object.keys(req.query||{}).length)return res.status(400).json({error:'invalid_request'});
   const inputs=await loadInstagram(actor);
   return res.status(200).json({...reviewBatch(inputs),platforms:{instagram:'authorized_reader',facebook:'capture_not_implemented'},
    blockers:['durable_audit_pending','verified_property_binding_pending','external_replies_check_pending','facebook_capture_pending']});
  }catch{return res.status(503).json({error:'observation_unavailable'});}
 };
}
