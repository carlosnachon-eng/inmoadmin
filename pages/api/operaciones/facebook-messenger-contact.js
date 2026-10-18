import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {sameOriginAdminRequest} from '../../../lib/shadow/identityBootstrap.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';
import {seal,open} from '../../../lib/messaging/facebook/messenger/crypto.js';
export const config={api:{bodyParser:{sizeLimit:'2kb'}}};
const validPhone=x=>typeof x==='string'&&x.length<=32&&/^[+0-9 ()-]*$/.test(x);
const validEmail=x=>typeof x==='string'&&x.length<=254&&(!x||/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x));
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 try{
  if(!['GET','POST'].includes(req.method))return res.status(405).end();
  if(req.method==='POST'&&!sameOriginAdminRequest(req))return res.status(403).end();
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active||!['admin','gerente_ventas','asesor','coord_operaciones','juridico'].includes(actor.role_id))return res.status(403).end();
  const c=messengerConfig(process.env);if(!c)return res.status(404).end();
  const thread=req.method==='GET'?req.query?.thread:req.body?.thread;
  if(!isRef(thread))return res.status(400).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==='GET'){
   const {data,error}=await db.rpc('fb_messenger_contact_get_v1',{p_connection:c.connection,p_thread:thread,p_actor:actor.id});
   if(error)throw Error('contact_unavailable');
   if(!data)return res.status(200).json({phone:'',email:''});
   const phone=data.phone_box?open(c,'contact-phone',[thread],data.phone_box):'';
   const email=data.email_box?open(c,'contact-email',[thread],data.email_box):'';
   return res.status(200).json({phone:validPhone(phone)?phone:'',email:validEmail(email)?email:''});
  }
  if(actor.role_id!=='admin')return res.status(403).end();
  if(!req.body||Object.keys(req.body).sort().join(',')!=='email,phone,thread'
  ||!validPhone(req.body.phone)||!validEmail(req.body.email))return res.status(400).end();
  const {data,error}=await db.rpc('fb_messenger_contact_save_v1',{p_connection:c.connection,p_thread:thread,p_actor:actor.id,
   p_phone:req.body.phone?seal(c,'contact-phone',[thread],req.body.phone):null,
   p_email:req.body.email?seal(c,'contact-email',[thread],req.body.email):null});
  if(error||data!==true)return res.status(403).json({status:'contact_denied'});
  return res.status(200).json({status:'saved'});
 }catch{return res.status(503).json({status:'contact_unavailable'});}
}
