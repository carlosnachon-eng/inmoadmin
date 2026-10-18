import {createHmac} from 'node:crypto';
import {open,seal} from './crypto.js';

export const REQUIRED_SCOPES=Object.freeze(['pages_messaging','pages_manage_metadata']);
const tokenShape=x=>typeof x==='string' && /^[A-Za-z0-9._|~-]{20,4096}$/.test(x);
const fail=(stage,extra={})=>({ok:false,stage,...extra});
// This is a Facebook Page-token contract, never the Instagram Login contract.
export function validatePageMetadata(c,data,now) {
  if (!data || Array.isArray(data) || typeof data!=='object') return fail('metadata_shape');
  if(data.is_valid!==true) return fail('token_invalid');
  if(data.app_id!==c.app) return fail('app_binding');
  if(data.profile_id!==c.page) return fail('page_binding');
  if(data.type!==undefined && data.type!=='PAGE') return fail('token_type');
  if(!Array.isArray(data.scopes)||!data.scopes.every(s=>typeof s==='string'&&/^[a-z_]{1,80}$/.test(s))) return fail('scopes_shape');
  const scopes=[...new Set(data.scopes)].sort();
  const missing=REQUIRED_SCOPES.filter(s=>!scopes.includes(s));
  if(missing.length) return fail('permissions',{missing_scopes:missing});
  for(const field of ['expires_at','data_access_expires_at']) {
    if(!Number.isSafeInteger(data[field])||data[field]<0) return fail('expiry_unknown');
    if(data[field] && data[field]*1000<=now+60000) return fail('token_expired');
  }
  if(data.granular_scopes!==undefined) {
    if(!Array.isArray(data.granular_scopes)) return fail('granular_scopes_shape');
    for(const g of data.granular_scopes) {
      if(!g || typeof g.scope!=='string') return fail('granular_scopes_shape');
      if(REQUIRED_SCOPES.includes(g.scope) && g.target_ids!==undefined &&
        (!Array.isArray(g.target_ids)||!g.target_ids.some(id=>id===c.page || (Number.isSafeInteger(id)&&String(id)===c.page)))) return fail('permission_target');
    }
  }
  // Even a Meta non-expiring token receives a conservative 24h local lease.
  const deadline=Math.min(now+86400000,...[data.expires_at,data.data_access_expires_at].filter(Boolean).map(s=>s*1000));
  return {ok:true,scopes,token_type:'PAGE',expires_at:data.expires_at||null,
    data_access_expires_at:data.data_access_expires_at||null,meta_non_expiring:data.expires_at===0,
    verified_at:new Date(now).toISOString(),valid_until:new Date(deadline).toISOString()};
}
export async function inspectPageToken(c,token,{fetchImpl=fetch,now=Date.now()}={}) {
  if(!tokenShape(token)) return fail('token_shape');
  let stage='introspection';
  const get=async(path,params,bearer)=>{
    const url=new URL(`https://graph.facebook.com/${c.version}/${path}`);
    for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
    // Never log URL/errors: debug_token's documented input_token is sensitive.
    const r=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${bearer}`}});
    let body;try{body=await r.json();}catch{return {error:fail(stage,{http_status:r.status})};}
    if(!r.ok || body?.error) return {error:fail(stage,{http_status:r.status,
      code:Number.isSafeInteger(body?.error?.code)?body.error.code:null,
      subcode:Number.isSafeInteger(body?.error?.error_subcode)?body.error.error_subcode:null})};
    return {body};
  };
  try {
    const debug=await get('debug_token',{input_token:token},`${c.app}|${c.secret}`);
    if(debug.error)return debug.error;
    const checked=validatePageMetadata(c,debug.body?.data,now);if(!checked.ok)return checked;
    stage='page_identity';
    const proof=createHmac('sha256',c.secret).update(token).digest('hex');
    const me=await get('me',{fields:'id',appsecret_proof:proof},token);
    if(me.error)return me.error;if(me.body?.id!==c.page)return fail(stage);
    stage='subscriptions';
    const subs=await get(`${c.page}/subscribed_apps`,{fields:'id,subscribed_fields',limit:'100',appsecret_proof:proof},token);
    if(subs.error)return subs.error;
    if(!Array.isArray(subs.body?.data))return fail('subscriptions_shape');
    const matching=subs.body.data.filter(x=>x?.id===c.app);
    if(matching.length>1)return fail('subscriptions_ambiguous');
    // Do not follow arbitrary next URLs (may contain credentials). Missing in a
    // paginated response is unknown, not proof that the app is not installed.
    if(!matching.length && subs.body?.paging?.next)return fail('subscriptions_pagination');
    const fields=matching[0]?.subscribed_fields||[];
    if(!Array.isArray(fields)||!fields.every(x=>typeof x==='string'&&/^[a-z_]{1,80}$/.test(x)))return fail('subscriptions_shape');
    return {...checked,stage:'verified',identity_verified:true,app_verified:true,
      subscribed_fields:[...new Set(fields)].sort(),inbound_ready:fields.includes('messages'),
      echo_ready:fields.includes('message_echoes')};
  } catch {return fail(stage,{reason:'transport_or_json_failure'});}
}
export async function provisionMessenger(c,{actor,store,token,health=false,fetchImpl,now=Date.now()}) {
  const previous=await store.credential();
  if(health) {
    if(!previous)return fail('credential_missing');
    try {token=open(c,'token',[previous.generation,previous.valid_until],previous.token_box);}catch{return fail('credential_binding');}
  }
  const result=await inspectPageToken(c,token,{fetchImpl,now});
  if(!result.ok)return result;
  const expected=previous?.generation||0;
  if(!Number.isSafeInteger(expected)||expected<0)return fail('generation');
  const generation=expected+1;
  const saved=await store.provision({actor:actor.id,app:c.app,page:c.page,expected_generation:expected,
    generation,scopes:result.scopes,verified_at:result.verified_at,valid_until:result.valid_until,
    token_box:seal(c,'token',[generation,result.valid_until],token),metadata:result});
  if(saved!==true)return fail('provision_conflict');
  return {...result,status:'credential_verified',generation,sender:'OFF'};
}
