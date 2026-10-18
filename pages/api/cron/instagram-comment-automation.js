import {timingSafeEqual} from 'node:crypto';
import {getAdminSupabase} from '../../../lib/ejecutivo/workCenter';
import {businessConfig} from '../../../lib/messaging/instagram/business/config';
import {createBusinessStore} from '../../../lib/messaging/instagram/business/store';
import {processBusinessCommentAutomations} from '../../../lib/messaging/instagram/business/comments';

export const config={maxDuration:60};
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'method_not_allowed'});
 if(!process.env.CRON_SECRET||!equal(req.headers.authorization,'Bearer '+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:'not_authorized'});
 // Explicitly separate non-sending shadow from approved outbound.
 const mode=process.env.INSTAGRAM_COMMENT_AUTOMATION_MODE;
 if(mode!=='shadow'&&mode!=='outbound')return res.status(200).json({ok:true,status:'disabled',processed:0});
 const outbound=mode==='outbound';
 if(outbound&&(process.env.INSTAGRAM_COMMENT_AUTOMATION_OUTBOUND_ENABLED!=='true'||process.env.INSTAGRAM_COMMENT_AUTOMATION_ENABLED!=='true'))
  return res.status(200).json({ok:true,status:'outbound_disabled',processed:0});

 try{
  const c=businessConfig(process.env);
  if(!c)return res.status(200).json({ok:true,status:'unconfigured',processed:0});
  if(outbound&&!c.senderEnabled)return res.status(200).json({ok:true,status:'sender_disabled',processed:0});
  const store=createBusinessStore(getAdminSupabase(),c.connection);
  const result=await processBusinessCommentAutomations({config:c,store,limit:10,dryRun:!outbound});
  console.info('instagram_comment_automation',{mode,processed:result.processed,states:result.results.map(x=>x.status)});
  return res.status(200).json({ok:true,mode,processed:result.processed,results:result.results});
 }catch{
  return res.status(503).json({ok:false,error:'comment_automation_unavailable'});
 }
}
