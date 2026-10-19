import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {sameOriginAdminRequest} from '../../../lib/shadow/identityBootstrap.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';
export const config={api:{bodyParser:{sizeLimit:'1kb'}}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 try{
  if(req.method==='POST'&&!sameOriginAdminRequest(req))return res.status(403).end();
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active)return res.status(403).end();
  const c=messengerConfig(process.env);if(!c)return res.status(404).end();
  const thread=req.method==='POST'?req.body?.thread:null;
  if(req.method==='POST'&&(!isRef(thread)||!req.body||Object.keys(req.body).join(',')!=='thread'))return res.status(400).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc('fb_messenger_read_state_v1',{
   p_connection:c.connection,p_actor:actor.id,p_thread:thread,p_op:thread?'mark':'list'
  });
  if(error)throw Error('read_state_unavailable');
  if(data===null)return res.status(403).end();
  return res.status(200).json(data);
 }catch{return res.status(503).json({status:'read_state_unavailable'});}
}
