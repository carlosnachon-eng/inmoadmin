import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';
import {COMMERCIAL_INBOX_ROLES} from '../../../lib/messaging/shared/channelPermissions.js';

// Read-only property suggestions. Actual sharing uses the existing durable text sender.
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(req.method!=='GET')return res.status(405).end();
 try{
  const c=messengerConfig(process.env),actor=await authorizeInboxStaff(req);
  if(!c||!actor?.active||!COMMERCIAL_INBOX_ROLES.includes(actor.role_id)||!isRef(req.query?.thread))return res.status(403).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:history,error:he}=await db.rpc('fb_messenger_inbox_v1',{p_connection:c.connection,p_actor:actor.id,p_thread:req.query.thread});
  if(he||!history||!Array.isArray(history.rows))return res.status(403).end();
  const {data,error}=await db.from('propiedades')
   .select('id,public_id,titulo,operacion,precio,moneda,colonia,ciudad')
   .eq('status','published').not('public_id','is',null)
   .order('updated_at',{ascending:false}).limit(150);
  if(error)throw Error('properties_unavailable');
  return res.status(200).json({rows:(data||[]).map(p=>({
   id:p.id,public_id:p.public_id,titulo:p.titulo||'Propiedad',operacion:p.operacion,
   precio:p.precio,moneda:p.moneda||'MXN',colonia:p.colonia||null,ciudad:p.ciudad||null
  }))});
 }catch{return res.status(503).json({status:'unavailable'});}
}
