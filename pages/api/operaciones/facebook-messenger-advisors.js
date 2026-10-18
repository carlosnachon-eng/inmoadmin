import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(req.method!=='GET')return res.status(405).end();
 try{
  const c=messengerConfig(process.env);
  if(!c)return res.status(404).end();
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active||!['admin','gerente_ventas'].includes(actor.role_id))return res.status(403).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.from('v_sales_team_directory')
   .select('advisor_profile_id,full_name,plaza_name,left_at').is('left_at',null);
  if(error)throw Error('directory_unavailable');
  const unique=new Map();
  for(const row of data||[]){
   if(!row.advisor_profile_id)continue;
   unique.set(row.advisor_profile_id,{id:row.advisor_profile_id,name:row.full_name||'Asesor',plaza:row.plaza_name||null});
  }
  return res.status(200).json({advisors:[...unique.values()]});
 }catch{return res.status(503).json({status:'directory_unavailable'});}
}
