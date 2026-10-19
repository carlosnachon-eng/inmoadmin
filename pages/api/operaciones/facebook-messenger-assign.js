import {createClient} from '@supabase/supabase-js';
import {sameOriginAdminRequest} from '../../../lib/shadow/identityBootstrap.js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {messengerConfig,isRef,isUuid} from '../../../lib/messaging/facebook/messenger/config.js';

export const config={api:{bodyParser:{sizeLimit:'2kb'}}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(!['POST','GET'].includes(req.method))return res.status(405).json({status:'method_not_allowed'});
 if(req.method==='POST'&&!sameOriginAdminRequest(req))return res.status(403).json({status:'forbidden'});
 try{
  const c=messengerConfig(process.env);
  if(!c)return res.status(404).end();
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active||!['admin','gerente_ventas'].includes(actor.role_id))
   return res.status(403).json({status:'forbidden'});
  if(req.method==='POST'&&(!req.body||Object.keys(req.body).sort().join(',')!=='advisor,thread'
   ||!isUuid(req.body.advisor)||!isRef(req.body.thread)))
   return res.status(400).json({status:'invalid_request'});
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==='GET'){
   if(!isRef(req.query?.thread))return res.status(400).end();
   const {data,error}=await db.rpc('fb_messenger_assignment_get_v1',{p_connection:c.connection,p_thread:req.query.thread,p_actor:actor.id});
   if(error)throw Error('assignment_unavailable');
   return res.status(200).json({assignment:data||null});
  }
  const {data,error}=await db.rpc('fb_messenger_assign_thread_v1',
   {p_connection:c.connection,p_thread:req.body.thread,p_actor:actor.id,p_advisor:req.body.advisor});
  if(error)throw Error('assignment_unavailable');
  return res.status(data===true?200:403).json({status:data===true?'assigned':'denied'});
 }catch{return res.status(503).json({status:'assignment_unavailable'});}
}
