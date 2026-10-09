import {createHash,timingSafeEqual} from 'node:crypto';
import {runControlledAdminOutbound} from './controlledOutbound.js';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest=value=>createHash('sha256').update(value).digest();
const states=new Set(['reserved','dispatch_started','accepted','failed','uncertain','review_required']);
function projectJournal(row){
  if(!row||!states.has(row.status)||![0,1].includes(row.send_calls))throw Error('journal_unavailable');
  for(const key of ['sent','delivered','read','failed','contradictory']){
    if(typeof row[key]!=='boolean')throw Error('journal_unavailable');
  }
  return {status:['reserved','dispatch_started'].includes(row.status)?'already_consumed':row.status};
}

// Manual POST only. No cookies, query credential, cron, webhook or self-invoke.
// Durable reserve/start in the existing runner remains the concurrency boundary.
export function createControlledOutboundOperator({env=process.env,makeStore,run=runControlledAdminOutbound}={}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    const reply=(code,status)=>res.status(code).json({status});
    if(req.method!=='POST')return reply(405,'blocked');
    const secret=env.META_ADMIN_OUTBOUND_OPERATOR_SECRET,auth=req.headers?.authorization;
    if(typeof secret!=='string'||secret.length<32||secret.length>256||typeof auth!=='string'||auth.length>512
      ||!timingSafeEqual(digest(auth),digest(`Bearer ${secret}`)))return reply(401,'blocked');
    const allowed=env.META_ADMIN_CONTROLLED_OUTBOUND_INPUT_ID;
    // No caller-selected input, even if it matches the configured UUID.
    if(!uuid.test(allowed||'')||(req.body!==undefined&&req.body!==null
      &&(typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==0))
      ||Object.keys(req.query||{}).length)return reply(403,'blocked');
    if(env.META_ADMIN_CONTROLLED_OUTBOUND_ENABLED!=='true')return reply(409,'disabled');
    if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.NEXT_PUBLIC_SUPABASE_URL||!env.META_ADMIN_OUTBOUND_ACCESS_TOKEN
      ||!/^gpt-[a-z0-9][a-z0-9.-]*$/.test(env.OPENAI_ADMIN_AGENT_MODEL||'')
      ||!['META_ADMIN_CAPTURE_ENCRYPTION_KEY','META_ADMIN_CAPTURE_HMAC_KEY'].every(k=>/^[a-f0-9]{64}$/.test(env[k]||'')))return reply(503,'blocked');
    try{
      const store=makeStore(env);
      const existing=await store.status(allowed);
      if(existing!==null)return res.status(200).json(projectJournal(existing));
      // Exactly one runner call. Ignore its response: only the durable journal is returned.
      await run({inputId:allowed,env,store,db:store.contextDb});
      return res.status(200).json(projectJournal(await store.status(allowed)));
    }catch{
      // Never retry or return raw provider/DB exceptions or caller input.
      return reply(503,'uncertain');
    }
  };
}
