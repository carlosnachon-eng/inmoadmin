import { createHash, timingSafeEqual } from 'node:crypto';
import { runMetaAdminShadowOnce, assertOpenAIShadowModel } from './shadowOnce.js';
import { sanitizeShadowText } from '../../shadow/coordinator.js';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest = x => createHash('sha256').update(x).digest();

// Operator-only action. No cookies/query tokens, cron, webhook or automatic caller.
export function createShadowOnceOperator({ env=process.env, makeStore, run=runMetaAdminShadowOnce }={}) {
  return async (req,res) => {
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    const reply=(code,status,proposal=null)=>res.status(code).json({status,proposed_response:proposal});
    if(req.method!=='POST')return reply(405,'blocked');
    const secret=env.META_ADMIN_SHADOW_OPERATOR_SECRET;
    const auth=req.headers?.authorization;
    if(typeof secret!=='string'||secret.length<32||typeof auth!=='string'||auth.length>512
      ||!timingSafeEqual(digest(auth),digest(`Bearer ${secret}`)))return reply(401,'blocked');
    const allowed=env.META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID;
    if(!uuid.test(allowed||'') || !req.body || Object.keys(req.body).length!==1
      || req.body.input_id!==allowed)return reply(403,'blocked');
    if(!env.OPENAI_API_KEY||!env.OPENAI_ADMIN_AGENT_MODEL||!env.SUPABASE_SERVICE_ROLE_KEY
      ||!env.NEXT_PUBLIC_SUPABASE_URL)return reply(503,'blocked');
    try { assertOpenAIShadowModel(env); } catch { return reply(503,'blocked'); }
    let proposal=null;
    try {
      const store=makeStore(env);
      const wrapped={...store,async finish(a){
        await store.finish(a);
        if(a.status==='complete' && typeof a.proposed_response==='string') {
          const s=sanitizeShadowText(a.proposed_response);
          if(!s.rejected)proposal=s.text;
        }
      }};
      const result=await run({inputId:allowed,authorizedInputId:allowed,store:wrapped,env});
      if(result.status==='complete')return reply(200,'complete',proposal);
      if(result.status==='invalidated')return reply(409,'invalidated');
      if(result.status==='uncertain')return reply(503,'uncertain');
      return reply(409,'blocked');
    }catch { return reply(503,'uncertain'); }
  };
}
