import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {SCOPES,PROVIDER} from './config.js';
import {seal,open} from './crypto.js';
import {PARSER_REASONS} from './parserReasons.js';
import {parseJsonWithLosslessUserId} from './losslessUserId.js';
const DAY=86400000, digest=x=>createHash('sha256').update(x).digest('hex');
const fail=()=>{throw Error('oauth_verification_failed');};
const tokenBinding=r=>[r.generation,r.issued_at,r.expires_at];
// Only locally constructed, allowlisted metadata can leave the OAuth module.
const diagnostics=new WeakMap(),transportDiagnostics=new WeakMap();
function parserFail(reason){
 const e=Error('oauth_verification_failed');
 if(PARSER_REASONS.includes(reason))transportDiagnostics.set(e,{parser_validation:reason});
 throw e;
}
export const businessOAuthDiagnostic=e=>e instanceof Error?diagnostics.get(e)||null:null;
const valueType=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const shapeKeys=o=>o&&typeof o==='object'&&!Array.isArray(o)?Object.keys(o).slice(0,32):[];
function shortTokenResponseShape(body){
 const root_type=valueType(body),top_level_keys=shapeKeys(body);
 const top_level_types=top_level_keys.map(key=>({key,type:valueType(body[key])}));
 const data_present=top_level_keys.includes('data'),data=body&&typeof body==='object'&&!Array.isArray(body)?body.data:undefined;
 const data_type=valueType(data),data_length=Array.isArray(data)?data.length:null;
 const data_items=Array.isArray(data)?data.slice(0,3).map(item=>{
  const type=valueType(item),keys=shapeKeys(item);
  return {type,keys,field_types:keys.map(key=>({key,type:valueType(item[key])}))};
 }):[];
 return {root_type,top_level_keys,top_level_types,data_present,data_type,data_length,data_items};
}
async function stage(name,fn){
 try{return await fn();}catch(cause){
  const e=Error('oauth_verification_failed');
  diagnostics.set(e,{stage:name,...(transportDiagnostics.get(cause)||{})});throw e;
 }
}
// No Graph response, request URL, exception or secret escapes this module.
async function request(url,options,fetchImpl,losslessId=false){
 let r,b;
 try{r=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail();}
 try{b=losslessId?parseJsonWithLosslessUserId(await r.text()):await r.json();}catch{const e=Error('oauth_verification_failed');transportDiagnostics.set(e,{http_status:Number.isInteger(r.status)?r.status:null,response_json_valid:false});throw e;}
 if(!r.ok||b?.error){const e=Error('oauth_verification_failed');transportDiagnostics.set(e,{http_status:Number.isInteger(r.status)?r.status:null,code:Number.isSafeInteger(b?.error?.code)?b.error.code:null,subcode:Number.isSafeInteger(b?.error?.error_subcode)?b.error.error_subcode:null});throw e;}
 return b;
}
function exactScopes(value){
 const s=Array.isArray(value)?value:typeof value==='string'?value.split(',').map(x=>x.trim()):[];
 if(s.length!==SCOPES.length||!SCOPES.every(x=>s.includes(x)))fail();return [...SCOPES];
}
// Instagram Login response observed in Preview on 2026-10-16:
// flat object, numeric user_id, permissions array. No legacy envelope fallback.
// Extract only these three fields; never infer an identity from other fields.
export function parseInstagramLoginShortToken(body){
 const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 if(!record(body))parserFail('root_not_object');
 if(Object.hasOwn(body,'data'))parserFail('data_envelope_present');
 if(['error','error_type','error_message'].some(k=>Object.hasOwn(body,k)))parserFail('error_field_present');
 if(!Object.hasOwn(body,'access_token'))parserFail('access_token_missing');
 if(!Object.hasOwn(body,'user_id'))parserFail('user_id_missing');
 if(!Object.hasOwn(body,'permissions'))parserFail('permissions_missing');
 const {access_token,user_id,permissions}=body;
 if(typeof access_token!=='string')parserFail('access_token_type');
 if(!access_token.trim())parserFail('access_token_empty');
 if(access_token!==access_token.trim())parserFail('access_token_whitespace');
 if(typeof user_id!=='string')parserFail('user_id_type');
 if(!/^[1-9][0-9]{0,31}$/.test(user_id))parserFail('user_id_format');
 if(!Array.isArray(permissions))parserFail('permissions_not_array');
 if(permissions.length===0)parserFail('permissions_empty');
 if(!permissions.every(p=>typeof p==='string'))parserFail('permission_item_type');
 if(!permissions.every(p=>/^[a-z][a-z0-9_]*$/.test(p)))parserFail('permission_item_format');
 if(new Set(permissions).size!==permissions.length)parserFail('permissions_duplicate');
 return {access_token,user_id,permissions:[...permissions]};
}
function expiry(body,now){
 if(typeof body.access_token!=='string'||!body.access_token||String(body.token_type).toLowerCase()!=='bearer'
  ||!Number.isInteger(body.expires_in)||body.expires_in<=DAY/1000||body.expires_in>61*DAY/1000)fail();
 return new Date(now+body.expires_in*1000).toISOString();
}
async function identity(c,token,fetchImpl){
 const b=await request(`https://graph.instagram.com/${c.version}/me?fields=user_id`,{headers:{Authorization:`Bearer ${token}`}},fetchImpl,true);
 if(typeof b.user_id!=='string'||b.user_id!==c.account)fail();
}
export async function beginBusinessOAuth({config:c,actor,sessionBinding,store,now=Date.now()}){
 if(!actor||!sessionBinding)fail();const state=randomBytes(32).toString('base64url');
 await store.createState({state_hash:digest(state),actor,session_hash:digest(sessionBinding),connection_id:c.connection,expires_at:new Date(now+600000).toISOString()});
 const url=new URL('https://www.instagram.com/oauth/authorize');url.search=new URLSearchParams({client_id:c.instagramApp,redirect_uri:c.redirect,response_type:'code',scope:SCOPES.join(','),state,enable_fb_login:'false'}).toString();
 return url.href;
}
export async function completeBusinessOAuth({config:c,state,code,actor,sessionBinding,store,fetchImpl=fetch,now=Date.now()}){
 await stage('callback_input',async()=>{if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state)||typeof code!=='string'||!code||code.length>4096||!actor||!sessionBinding)fail();});
 await stage('state_validation',async()=>{if(!await store.consumeState({state_hash:digest(state),actor,session_hash:digest(sessionBinding),connection_id:c.connection,now:new Date(now).toISOString()}))throw Error('state_denied');});
 const form=new FormData();for(const [k,v] of Object.entries({client_id:c.instagramApp,client_secret:c.secret,grant_type:'authorization_code',redirect_uri:c.redirect,code}))form.set(k,v);
 const short=await stage('short_token_exchange',()=>request('https://api.instagram.com/oauth/access_token',{method:'POST',body:form},fetchImpl,true));
 const granted=await stage('short_token_shape',async()=>{
  try{return parseInstagramLoginShortToken(short);}
  catch(e){transportDiagnostics.set(e,{...(transportDiagnostics.get(e)||{}),short_token_response_shape:shortTokenResponseShape(short)});throw e;}
 });
 const scopes=await stage('granted_scopes',async()=>exactScopes(granted?.permissions));
 await stage('short_token_presence',async()=>{if(!granted.access_token)fail();});
 await stage('short_token_identity',()=>identity(c,granted.access_token,fetchImpl));
 const u=new URL('https://graph.instagram.com/access_token');u.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:c.secret,access_token:granted.access_token}).toString();
 const long=await stage('long_token_exchange',()=>request(u,{},fetchImpl));
 const expires_at=await stage('long_token_type_expiry',async()=>expiry(long,now));
 await stage('long_token_identity',()=>identity(c,long.access_token,fetchImpl));
 const row={provider:PROVIDER,connection_id:c.connection,app_id:c.app,instagram_app_id:c.instagramApp,account_id:c.account,generation:randomUUID(),issued_at:new Date(now).toISOString(),expires_at,verified_at:new Date(now).toISOString(),scopes,token_type:'bearer',status:'healthy'};
 row.token_box=await stage('credential_encryption',async()=>seal(c,'token',tokenBinding(row),{access_token:long.access_token}));
 await stage('credential_persistence',()=>store.saveCredential(row));
 return health(row,now);
}
export function health(r,now=Date.now()){
 const expires=Date.parse(r?.expires_at),verified=Date.parse(r?.verified_at),issued=Date.parse(r?.issued_at);
 let state='healthy';
 if(!r||!Number.isFinite(expires)||!Number.isFinite(issued)||!Number.isFinite(verified)||expires<=issued||issued>now)state='unavailable';
 else if(expires<=now)state='expired';
 else if(r.status!=='healthy')state='reauthorization_required';
 else if(r.maintenance_lease)state='maintenance_pending';
 else if(verified>now||now-verified>DAY)state='stale';
 else if(expires-now<=7*DAY)state='refresh_due';
 return {status:state,expires_at:Number.isFinite(expires)?r.expires_at:null,verified_at:Number.isFinite(verified)?r.verified_at:null,refresh_due:Number.isFinite(expires)&&expires-now<=7*DAY,send_allowed:['healthy','refresh_due'].includes(state)};
}
export function tokenForSend(c,row,now=Date.now()){
 if(row?.provider!==PROVIDER||row.connection_id!==c.connection||row.app_id!==c.app||row.instagram_app_id!==c.instagramApp||row.account_id!==c.account||!health(row,now).send_allowed)throw Error('token_unavailable');
 exactScopes(row.scopes);const v=open(c,'token',tokenBinding(row),row.token_box);if(typeof v.access_token!=='string'||!v.access_token)fail();return v.access_token;
}
// Scheduler/health route must supply an authenticated server store. CAS lease
// prevents overlapping refreshes. No indefinite retry after uncertain refresh.
export async function maintainBusinessToken({config:c,store,fetchImpl=fetch,now=Date.now()}){
 const r=await store.loadCredential(c.connection),h=health(r,now);if(!r||['expired','unavailable','reauthorization_required','maintenance_pending'].includes(h.status))return h;
 if(r.provider!==PROVIDER||r.connection_id!==c.connection||r.app_id!==c.app||r.instagram_app_id!==c.instagramApp||r.account_id!==c.account)fail();
 exactScopes(r.scopes);const token=open(c,'token',tokenBinding(r),r.token_box).access_token;
 const lease=randomUUID();if(!await store.claimMaintenance(r.generation,lease))return {status:'maintenance_busy'};
 try{
  await identity(c,token,fetchImpl);let next={...r,verified_at:new Date(now).toISOString(),status:'healthy'};
  if(h.refresh_due){
   if(now-Date.parse(r.issued_at)<DAY)throw Error('refresh_too_early');
   const u=new URL('https://graph.instagram.com/refresh_access_token');u.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:token}).toString();
   const b=await request(u,{},fetchImpl);const expires_at=expiry(b,now);await identity(c,b.access_token,fetchImpl);
   next={...next,generation:randomUUID(),issued_at:new Date(now).toISOString(),expires_at};next.token_box=seal(c,'token',tokenBinding(next),{access_token:b.access_token});
  }
  if(!await store.finishMaintenance(r.generation,lease,next))throw Error('maintenance_cas_failed');return health(next,now);
 }catch{await store.failMaintenance(r.generation,lease,'reauthorization_required');return {status:'reauthorization_required',send_allowed:false};}
}
