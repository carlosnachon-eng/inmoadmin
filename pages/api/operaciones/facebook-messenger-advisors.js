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
  const [{data:team,error:teamError},{data:leaders,error:leaderError}]=await Promise.all([
   db.from('v_sales_team_directory').select('advisor_profile_id,full_name,plaza_name,left_at').is('left_at',null),
   db.from('profiles').select('id,full_name,email,role_id').eq('active',true)
    .in('role_id',['admin','gerente_ventas']).order('full_name',{ascending:true})
  ]);
  if(teamError||leaderError)throw Error('directory_unavailable');
  const unique=new Map();
  for(const row of team||[]){
   if(!row.advisor_profile_id)continue;
   unique.set(row.advisor_profile_id,{id:row.advisor_profile_id,name:row.full_name||'Asesor',plaza:row.plaza_name||null,role_id:'asesor'});
  }
  for(const p of leaders||[]){
   if(!p.id)continue;
   unique.set(p.id,{id:p.id,name:p.full_name||p.email||'Dirección',plaza:null,role_id:p.role_id});
  }
  return res.status(200).json({advisors:[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'))});
 }catch{return res.status(503).json({status:'directory_unavailable'});}
}
