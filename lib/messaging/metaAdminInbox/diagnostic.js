// Temporary, fixed-target read-only diagnostic. No sender, journal or model imports.
export const DIAGNOSTIC_EXPIRES = Date.parse('2026-10-09T18:05:00Z');
const APP='1728488815945294',WABA='1297760461811288',PHONE='1198305790026665';
const SCOPES=['whatsapp_business_management','whatsapp_business_messaging'];
const enumValue=x=>typeof x==='string'&&/^[A-Z][A-Z_]{1,40}$/.test(x)?x:null;
const error=x=>({http:Number.isInteger(x?.code)?x.code:null,code:Number.isInteger(x?.body?.error?.code)?x.body.error.code:null,subcode:Number.isInteger(x?.body?.error?.error_subcode)?x.body.error.error_subcode:null});
export async function diagnoseMeta({env=process.env,fetchImpl=fetch}={}){
 const token=env.META_ADMIN_OUTBOUND_ACCESS_TOKEN;
 if(!token)throw Error('unavailable');
 // Graph batch is a POST envelope, but EVERY operation inside is GET.
 // input_token remains in the request body, never URL, logs or returned data.
 const paths=[`debug_token?input_token=${encodeURIComponent(token)}`,'me/permissions',`${WABA}?fields=id`,`${WABA}/phone_numbers?fields=id&limit=100`,`${PHONE}?fields=id`,`${PHONE}?fields=platform_type,code_verification_status,status`,`${PHONE}?fields=health_status`];
 const response=await fetchImpl('https://graph.facebook.com/v26.0/',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({batch:JSON.stringify(paths.map(relative_url=>({method:'GET',relative_url}))),include_headers:'false'}).toString()});
 if(!response.ok)throw Error('unavailable');
 const raw=await response.json();if(!Array.isArray(raw)||raw.length!==paths.length)throw Error('unavailable');
 const r=raw.map(x=>{try{return {code:x?.code,body:JSON.parse(x?.body)}}catch{return {code:x?.code,body:null}}});
 const ok=i=>r[i].code===200&&!r[i].body?.error;
 const d=ok(0)?r[0].body?.data:null;
 const granted=Array.isArray(d?.scopes)?d.scopes:ok(1)&&Array.isArray(r[1].body?.data)?r[1].body.data.filter(x=>x.status==='granted').map(x=>x.permission):null;
 const scopes=Object.fromEntries(SCOPES.map(s=>[s,granted?granted.includes(s):null]));
 const valid=typeof d?.is_valid==='boolean'?d.is_valid:null;
 const appMatch=typeof d?.app_id==='string'?d.app_id===APP:null;
 const waba=ok(2)&&r[2].body?.id===WABA,phone=ok(4)&&r[4].body?.id===PHONE;
 const relation=ok(3)&&Array.isArray(r[3].body?.data)?r[3].body.data.some(x=>x.id===PHONE)?true:r[3].body?.paging?.next?null:false:null;
 const h=ok(6)?r[6].body?.health_status:null;
 const entities=Array.isArray(h?.entities)?h.entities:[];
 const codes=[...new Set(entities.flatMap(x=>Array.isArray(x.errors)?x.errors:[]).map(x=>x.error_code??x.code).filter(Number.isInteger))];
 const cause=valid===false?'token_invalid':appMatch===false?'token_app_mismatch':scopes.whatsapp_business_messaging===false?'messaging_scope_missing':relation===false?'phone_not_in_expected_waba':codes.length?'meta_health_error':'not_determined';
 const fixes={token_invalid:'replace_credential_only_after_review',token_app_mismatch:'use_expected_app_credential_after_review',messaging_scope_missing:'grant_messaging_scope_and_asset_access_after_review',phone_not_in_expected_waba:'review_asset_context_no_automatic_change',meta_health_error:'review_official_health_error_no_automatic_change',not_determined:'provider_403_body_not_retained_further_evidence_required'};
 return {token_valid:valid,expected_app_id:APP,app_matches:appMatch,scopes,waba_accessible:waba,phone_number_id_accessible:phone,phone_in_expected_waba:relation,authorized_context:valid===true&&appMatch===true&&waba&&phone&&relation===true&&scopes.whatsapp_business_messaging===true,number_state:{platform_type:ok(5)?enumValue(r[5].body?.platform_type):null,code_verification_status:ok(5)?enumValue(r[5].body?.code_verification_status):null,status:ok(5)?enumValue(r[5].body?.status):null,can_send_message:enumValue(h?.can_send_message),health_error_codes:codes},read_errors:r.map((x,i)=>({source:['token','permissions','waba','waba_phone_membership','phone','phone_state','health'][i],...error(x)})).filter(x=>x.http!==200),cause,minimum_correction:fixes[cause],historical_403_exact_cause_proven:false};
}
export function createDiagnosticHandler({authorize,env=process.env,fetchImpl,now=Date.now}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(now()>=DIAGNOSTIC_EXPIRES)return res.status(410).json({status:'disabled'});
  if(req.method!=='GET'||Object.keys(req.query||{}).length)return res.status(405).json({status:'blocked'});
  try{const actor=await authorize(req);if(!actor?.active||actor.role_id!=='admin')return res.status(403).json({status:'blocked'});
   return res.status(200).json(await diagnoseMeta({env,fetchImpl}));
  }catch{return res.status(503).json({status:'diagnostic_unavailable'});}
 };
}
