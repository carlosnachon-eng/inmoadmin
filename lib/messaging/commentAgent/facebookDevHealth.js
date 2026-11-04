import {createHmac} from 'node:crypto';
export const DEV='https://hjfwjnejbcpmknvfpdcq.supabase.co';
const APP='2220237475209417',PAGE='119960324707764',CONNECTION='74c3f858-c4f6-40af-a068-6ef159819a87';
const REQUIRED=['pages_show_list','pages_manage_metadata','pages_read_engagement','pages_read_user_content'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Independent read-only health surface. No capture, RPC, refresh or dispatch.
export function createFacebookDevHealth({env,fetchImpl=fetch,now=Date.now}){
 return async req=>{
  let stage='authorization',httpStatus=null,code=null,subcode=null;
  const reply=(status,extra={},http=200)=>Response.json({status,stage,sender:false,capture_activated:false,dispatches:0,...extra},{status:http,headers:{'Cache-Control':'private,no-store'}});
  try{
   const e=env();
   if(e.SUPABASE_URL!==DEV)return reply('FAIL',{},404);
   if(req.method!=='GET'||new URL(req.url).search)return reply('FAIL',{},405);
   const auth=req.headers.get('authorization');
   if(!/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(auth||''))return reply('FAIL',{},403);
   const service=e.SUPABASE_SERVICE_ROLE_KEY;
   if(!service)return reply('FAIL',{},503);
   const read=async(url,bearer,apikey)=>{
    const r=await fetchImpl(url,{method:'GET',headers:{Authorization:bearer,...(apikey?{apikey}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    httpStatus=r.status;const b=await r.json();
    if(!r.ok||b?.error){code=Number.isSafeInteger(b?.error?.code)?b.error.code:null;subcode=Number.isSafeInteger(b?.error?.error_subcode)?b.error.error_subcode:null;throw Error('upstream');}return b;
   };
   const user=await read(DEV+'/auth/v1/user',auth,service);
   if(!UUID.test(user?.id||''))return reply('FAIL',{},403);
   const profiles=await read(DEV+'/rest/v1/profiles?select=id,role_id,active&id=eq.'+user.id,auth,service);
   if(!Array.isArray(profiles)||profiles.length!==1||profiles[0].id!==user.id||profiles[0].active!==true||!['admin','gerente_ventas'].includes(profiles[0].role_id))return reply('FAIL',{},403);
   stage='configuration';
   if(e.FACEBOOK_COMMENTS_DEV_APP_ID!==APP||e.FACEBOOK_COMMENTS_DEV_PAGE_ID!==PAGE||e.FACEBOOK_COMMENTS_DEV_CONNECTION_ID!==CONNECTION||e.FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED!=='false')return reply('FAIL');
   const token=e.FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN,secret=e.FACEBOOK_COMMENTS_DEV_APP_SECRET;
   if(!/^[A-Za-z0-9._|~-]{20,4096}$/.test(token||'')||!/^[a-fA-F0-9]{32}$/.test(secret||''))return reply('FAIL');
   const get=(path,params,bearer)=>{const u=new URL('https://graph.facebook.com/v26.0/'+path);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);return read(u,'Bearer '+bearer);};
   stage='introspection';
   const {data:d}=await get('debug_token',{input_token:token},APP+'|'+secret);
   if(!d||d.is_valid!==true)return reply('FAIL');
   stage='app_binding';if(d.app_id!==APP)return reply('FAIL');
   stage='page_binding';if(d.profile_id!==PAGE)return reply('FAIL');
   stage='token_type';if(d.type!=='PAGE')return reply('FAIL');
   stage='permissions';
   if(!Array.isArray(d.scopes)||!d.scopes.every(s=>typeof s==='string'&&/^[a-z_]{1,80}$/.test(s)))return reply('FAIL');
   const missing=REQUIRED.filter(s=>!d.scopes.includes(s));if(missing.length)return reply('FAIL',{missing_scopes:missing});
   if(d.granular_scopes!==undefined){
    if(!Array.isArray(d.granular_scopes))return reply('FAIL');
    for(const g of d.granular_scopes){if(!g||typeof g.scope!=='string')return reply('FAIL');if(REQUIRED.includes(g.scope)&&g.target_ids!==undefined&&(!Array.isArray(g.target_ids)||!g.target_ids.includes(PAGE)))return reply('FAIL');}
   }
   stage='expiry';
   for(const k of ['expires_at','data_access_expires_at'])if(!Number.isSafeInteger(d[k])||d[k]<0||(d[k]!==0&&d[k]*1000<=now()+60000))return reply('FAIL');
   const proof=createHmac('sha256',secret).update(token).digest('hex');
   stage='identity';const me=await get('me',{fields:'id',appsecret_proof:proof},token);if(me?.id!==PAGE)return reply('FAIL');
   stage='subscription';const subs=await get(PAGE+'/subscribed_apps',{fields:'id,subscribed_fields',limit:'100',appsecret_proof:proof},token);
   if(!Array.isArray(subs?.data))return reply('FAIL');const own=subs.data.filter(x=>x?.id===APP);
   if(own.length!==1||!Array.isArray(own[0].subscribed_fields)||own[0].subscribed_fields.length!==1||own[0].subscribed_fields[0]!=='feed')return reply('FAIL');
   stage='verified';return reply('PASS',{identity_verified:true,app_verified:true,token_type:'PAGE',scopes:[...new Set(d.scopes)].sort(),expires_at:d.expires_at,data_access_expires_at:d.data_access_expires_at,meta_non_expiring:d.expires_at===0,subscribed_fields:['feed'],verified_at:new Date(now()).toISOString()});
  }catch{return reply('FAIL',{http_status:httpStatus,code,subcode},stage==='authorization'?403:200);}
 };
}
