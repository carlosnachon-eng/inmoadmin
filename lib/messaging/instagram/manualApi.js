import {sameOriginAdminRequest} from '../../shadow/identityBootstrap.js';
import {instagramInput,runInstagramManualReply} from './manualSender.js';

// authorize must use the existing server-side session; no actor/recipient in body.
// Factory only: not mounted in the public webhook or any Production route.
export function createInstagramManualHandler({authorize,store,env=process.env,fetchImpl}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(env.VERCEL_ENV==='production'||!['test','preview','development'].includes(env.APP_ENV)
      ||env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')return res.status(404).json({status:'disabled'});
    if(!['GET','POST'].includes(req.method))return res.status(405).json({status:'blocked'});
    try {
      const actor=await authorize(req);
      if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))return res.status(403).json({status:'blocked'});
      if(req.method==='GET') {
        if(Object.keys(req.query||{}).join(',')!=='input'||!instagramInput(req.query.input))return res.status(400).json({status:'blocked'});
        const data=await store().status(req.query.input,actor.id);
        return res.status(data?200:403).json(data?{data}:{status:'blocked'});
      }
      if(!sameOriginAdminRequest(req))return res.status(403).json({status:'blocked'});
      if(Object.keys(req.query||{}).length||!req.body||Array.isArray(req.body)
        ||Object.keys(req.body).sort().join(',')!=='action,input,text')return res.status(400).json({status:'blocked'});
      return res.status(200).json(await runInstagramManualReply({...req.body,actor,store:store(),env,fetchImpl}));
    }catch{return res.status(503).json({status:'uncertain'});}
  };
}
