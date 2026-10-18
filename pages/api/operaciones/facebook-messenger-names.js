import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {sameOriginAdminRequest} from '../../../lib/shadow/identityBootstrap.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';
import {seal,open} from '../../../lib/messaging/facebook/messenger/crypto.js';
export const config={api:{bodyParser:{sizeLimit:'1kb'}}};
const clean=x=>typeof x==='string'&&x.trim()===x&&x.length>=2&&x.length<=90&&!/[<>\\x00-\\x1f]/.test(x);
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 try{
  if(!['GET','POST'].includes(req.method))return res.status(405).end();
  if(req.method==='POST'&&!sameOriginAdminRequest(req))return res.status(403).end();
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active||!['admin','gerente_ventas','asesor','coord_operaciones','juridico'].includes(actor.role_id))return res.status(403).end();
  const c=messengerConfig(process.env);if(!c)return res.status(404).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==='GET'){
   const {data,error}=await db.rpc('fb_messenger_names_v1',{p_connection:c.connection,p_actor:actor.id});
   if(error)throw Error('names_unavailable');
   return res.status(200).json({rows:(Array.isArray(data)?data:[]).map(row=>{
    const binding=[row.thread_ref];
    const alias=row.alias_box?open(c,'name-alias',binding,row.alias_box):null;
    const profile=row.profile_box?open(c,'name-profile',binding,row.profile_box):null;
    return {thread_ref:row.thread_ref,alias:clean(alias)?alias:null,profile_name:clean(profile)?profile:null};
   })});
  }
  if(actor.role_id!=='admin')return res.status(403).end();
  if(!req.body||Object.keys(req.body).sort().join(',')!=='alias,thread'
    ||!isRef(req.body.thread)||!clean(req.body.alias))return res.status(400).end();
  const {data,error}=await db.rpc('fb_messenger_name_save_v1',{
   p_connection:c.connection,p_thread:req.body.thread,p_actor:actor.id,p_kind:'alias',
   p_box:seal(c,'name-alias',[req.body.thread],req.body.alias)});
  if(error||data!==true)return res.status(403).json({status:'name_denied'});
  return res.status(200).json({status:'saved'});
 }catch{return res.status(503).json({status:'names_unavailable'});}
}
