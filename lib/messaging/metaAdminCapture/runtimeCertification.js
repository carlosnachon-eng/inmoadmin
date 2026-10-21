// Read-only, fixed Administration target. Never import sender, DB writer or model.
const APP='1728488815945294',WABA='1297760461811288',PHONE='1198305790026665',SYSTEM='61595438812168';
const CALLBACK='https://app.emporioinmobiliario.com.mx/api/webhooks/meta';
export const CERTIFICATION_EXPIRES=Date.parse('2026-10-23T06:00:00Z');
const bool=x=>typeof x==='boolean'?x:null;
const integer=x=>Number.isSafeInteger(x)?x:null;
const state=x=>typeof x==='string'&&/^[A-Z_]{2,50}$/.test(x)?x:null;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)?x:null;

export async function certifyMetaRuntime({env=process.env,fetchImpl=fetch}={}) {
  const runtime={environment:['production','preview','development'].includes(env.VERCEL_ENV)?env.VERCEL_ENV:null,
    sha:sha(env.VERCEL_GIT_COMMIT_SHA),manual_reply_gate:env.META_ADMIN_MANUAL_REPLY_ENABLED==='true',
    controlled_outbound_gate:env.META_ADMIN_CONTROLLED_OUTBOUND_ENABLED==='true',
    observer_gate:env.META_ADMIN_OBSERVER_ENABLED==='true',capture_gate:env.META_ADMIN_SHADOW_CAPTURE_ENABLED==='true',
    scope_matches:env.META_ADMIN_WABA_ID===WABA&&env.META_ADMIN_PHONE_NUMBER_ID===PHONE};
  const token=env.META_ADMIN_OUTBOUND_ACCESS_TOKEN;
  if(typeof token!=='string'||!token)return {status:'credential_unavailable',runtime};
  // Batch envelope POST; EVERY enclosed operation is GET. Token never enters URL/output.
  const paths=[`debug_token?input_token=${encodeURIComponent(token)}`,'me?fields=id',
    `${WABA}?fields=id`,`${WABA}/phone_numbers?fields=id&limit=100`,`${PHONE}?fields=id`,
    `${WABA}/subscribed_apps?limit=100`,`${PHONE}?fields=status,platform_type,code_verification_status`,
    `${PHONE}?fields=health_status`,`${PHONE}?fields=is_on_biz_app,platform_type`,'me/permissions'];
  try{
    const response=await fetchImpl('https://graph.facebook.com/v26.0/',{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,
        'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
          batch:JSON.stringify(paths.map(relative_url=>({method:'GET',relative_url}))),include_headers:'false'}).toString()});
    if(!response.ok)return {status:'graph_unavailable',runtime,http:integer(response.status)};
    const raw=await response.json();if(!Array.isArray(raw)||raw.length!==paths.length)throw Error();
    const r=raw.map(x=>{let body=null;try{body=JSON.parse(x?.body)}catch{}
      return {http:integer(x?.code),body};});
    const ok=i=>r[i].http===200&&r[i].body&&!r[i].body.error;
    const d=ok(0)?r[0].body.data:null;
    const me=ok(1)&&typeof r[1].body.id==='string'?r[1].body.id:null;
    const debugUser=typeof d?.user_id==='string'?d.user_id:null;
    const user=debugUser??me;
    const phones=ok(3)&&Array.isArray(r[3].body.data)?r[3].body:null;
    const apps=ok(5)&&Array.isArray(r[5].body.data)?r[5].body:null;
    const app=apps?.data.find(x=>x?.whatsapp_business_api_data?.id===APP);
    const override=app?.override_callback_uri;
    const health=ok(7)?r[7].body.health_status:null;
    const granted=ok(9)&&Array.isArray(r[9].body.data)?r[9].body.data:null;
    const codes=[...new Set((Array.isArray(health?.entities)?health.entities:[])
      .flatMap(x=>Array.isArray(x?.errors)?x.errors:[]).map(x=>integer(x?.error_code??x?.code)).filter(x=>x!==null))].slice(0,20);
    return {status:'review_required',runtime,token:{valid:bool(d?.is_valid),
      app_matches:typeof d?.app_id==='string'?d.app_id===APP:null,
      expected_system_user_matches:user?user===SYSTEM:null,
      identity_conflict:me&&debugUser?me!==debugUser:null,expires_at:integer(d?.expires_at),
      scopes:Object.fromEntries(['whatsapp_business_management','whatsapp_business_messaging'].map(s=>
        [s,Array.isArray(d?.scopes)?d.scopes.includes(s):null]))},
      permission_grants:Object.fromEntries(['whatsapp_business_management','whatsapp_business_messaging'].map(s=>
        [s,granted?granted.some(x=>x?.permission===s&&x.status==='granted'):null])),
      waba_accessible:ok(2)?r[2].body.id===WABA:null,phone_accessible:ok(4)?r[4].body.id===PHONE:null,
      membership:phones&&!phones.paging?.next?phones.data.some(x=>x?.id===PHONE):null,
      subscription:{expected_app_present:apps&&!apps.paging?.next?Boolean(app):null,
        complete:apps?!apps.paging?.next:false,
        override_callback_matches:typeof override==='string'?override===CALLBACK:null},
      number:{status:ok(6)?state(r[6].body.status):null,platform:ok(6)?state(r[6].body.platform_type):null,
        verification:ok(6)?state(r[6].body.code_verification_status):null,
        is_on_biz_app:ok(8)?bool(r[8].body.is_on_biz_app):null,
        can_send_message:state(health?.can_send_message),health_error_codes:codes},
      errors:r.map((x,i)=>({source:['token','actor','waba','membership','phone','subscription','number','health','registration','permissions'][i],
        http:x.http,code:integer(x.body?.error?.code),subcode:integer(x.body?.error?.error_subcode)})).filter(x=>x.http!==200||x.code!==null),
      eligibility:'not_confirmed',send_calls:0};
  }catch{return {status:'graph_unavailable',runtime};}
}

export function createRuntimeCertificationHandler({authorize,env=process.env,fetchImpl,now=Date.now}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    // Immutable deployment URLs must not keep a live diagnostic after alias rollback.
    if(env.VERCEL_ENV==='production'&&req.headers?.host!=='app.emporioinmobiliario.com.mx')
      return res.status(404).json({status:'disabled'});
    if(env.META_ADMIN_CONNECTION_CERTIFICATION_ENABLED!=='true')return res.status(404).json({status:'disabled'});
    if(now()>=CERTIFICATION_EXPIRES)return res.status(410).json({status:'expired'});
    if(req.method!=='GET'||Object.keys(req.query||{}).length)return res.status(405).json({status:'blocked'});
    try{
      const actor=await authorize(req);
      if(!actor?.active||actor.role_id!=='admin')return res.status(403).json({status:'blocked'});
      return res.status(200).json(await certifyMetaRuntime({env,fetchImpl}));
    }catch{return res.status(503).json({status:'unavailable'});}
  };
}
