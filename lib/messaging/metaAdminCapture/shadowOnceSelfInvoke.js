// Temporary manual adapter. The operator credential never leaves this runtime.
// The existing handler/runner remains the sole owner of gates and durable claim.
export function createShadowOnceSelfInvoke({ authorize, operator, env=process.env }) {
  return async (req,res) => {
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    const blocked=code=>res.status(code).json({status:'blocked',proposed_response:null});
    if(req.method!=='POST')return blocked(405);
    if(env.VERCEL_ENV!=='production')return blocked(403);
    // Browser-only manual action, no cookies-as-auth, no cross-origin trigger.
    if(req.headers?.origin!=='https://app.emporioinmobiliario.com.mx'
      ||req.headers?.['content-type']!=='application/json'
      ||!req.body||Array.isArray(req.body)||Object.keys(req.body).length!==0)return blocked(403);
    try {
      const profile=await authorize(req);
      if(!profile?.active||profile.role_id!=='admin')return blocked(403);
      const input=env.META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID;
      const secret=env.META_ADMIN_SHADOW_OPERATOR_SECRET;
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input||'')
        ||typeof secret!=='string'||secret.length<32)return blocked(503);
      // One in-process invocation, no HTTP retry/redirect or secret extraction.
      // Existing UNIQUE(input_id) claim prevents another model attempt, including
      // concurrent callers and uncertain outcomes. Never chooses another input.
      return await operator({method:'POST',headers:{authorization:`Bearer ${secret}`},
        body:{input_id:input}},res);
    } catch {
      return res.status(503).json({status:'uncertain',proposed_response:null});
    }
  };
}
