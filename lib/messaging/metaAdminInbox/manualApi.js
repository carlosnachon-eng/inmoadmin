import {sameOriginAdminRequest} from '../../shadow/identityBootstrap.js';
import {manualUuid,runManualReply} from './manual.js';
export function createManualHandler({authorize,store,env=process.env,fetchImpl}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({status:'blocked'});
    try {
      const actor=await authorize(req);
      if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))return res.status(403).json({status:'blocked'});
      const s=store();
      if(req.method==='GET'){
        if(Object.keys(req.query||{}).some(k=>k!=='input_id')||!manualUuid(req.query?.input_id))return res.status(400).json({status:'blocked'});
        const data=await s.status(req.query.input_id,actor.id);
        if(!data)return res.status(403).json({status:'blocked'});
        return res.status(200).json({data,enabled:env.META_ADMIN_MANUAL_REPLY_ENABLED==='true'});
      }
      if(!sameOriginAdminRequest(req))return res.status(403).json({status:'blocked'});
      if(Object.keys(req.query||{}).length||!req.body||Array.isArray(req.body)
        ||Object.keys(req.body).sort().join(',')!=='action_id,input_id,text')return res.status(400).json({status:'blocked'});
      const result=await runManualReply({inputId:req.body.input_id,actionId:req.body.action_id,text:req.body.text,actor,store:s,env,fetchImpl});
      return res.status(200).json(result);
    }catch{return res.status(503).json({status:'uncertain'});}
  };
}
