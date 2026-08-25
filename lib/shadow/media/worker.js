import { decryptMediaReference, MEDIA_ALLOWED_MIME } from "./reference.js";
import { secureDownload, validateDownloadedMedia } from "./network.js";
import crypto from "node:crypto";

const RETRY_MINUTES=[1,3,8,16];
const safeCode=(error)=>String(error?.code||"media_retrieval_failed").replace(/[^a-z0-9_]/g,"").slice(0,80)||"media_retrieval_failed";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_RETURN_FIELDS=["id","status","locked_by","encrypted_reference","wrapped_key","nonce","auth_tag"];
const invalidClaim=()=>Object.assign(new Error("invalid_claim_shape"),{code:"invalid_claim_shape"});
const emptyClaim=(value)=>value&&typeof value==="object"&&!Array.isArray(value)&&(Object.keys(value).length===0||
  (EMPTY_RETURN_FIELDS.every((field)=>Object.hasOwn(value,field))&&Object.values(value).every((item)=>item==null)));

export const mediaRetrievalWorkerEnabled=(env=process.env)=>env.SHADOW_MEDIA_RETRIEVAL_ENABLED==="true"&&env.SHADOW_OUTBOUND_ENABLED!=="true";

export function normalizeMediaClaimResult(data,{workerId}={}){
  if(data==null)return null;
  let claim=data;
  if(Array.isArray(data)){
    if(data.length===0)return null;
    if(data.length!==1)throw invalidClaim();
    claim=data[0];
  }
  if(claim==null||emptyClaim(claim))return null;
  if(typeof claim!=="object"||Array.isArray(claim))throw invalidClaim();
  const requiredStrings=["encrypted_reference","wrapped_key","nonce","auth_tag","declared_mime","expires_at","locked_at"];
  const valid=UUID_RE.test(String(claim.id||""))&&UUID_RE.test(String(claim.locked_by||""))&&
    UUID_RE.test(String(workerId||""))&&claim.locked_by===workerId&&claim.status==="processing"&&
    Number.isInteger(claim.attempts)&&claim.attempts>=1&&requiredStrings.every((field)=>typeof claim[field]==="string"&&claim[field].length>0)&&
    Number.isFinite(Date.parse(claim.expires_at))&&Number.isFinite(Date.parse(claim.locked_at));
  if(!valid)throw invalidClaim();
  return claim;
}

export async function processOneMediaRetrieval(admin,{privateKeyPem=process.env.SHADOW_MEDIA_RETRIEVAL_PRIVATE_KEY,download=secureDownload,now=new Date(),workerId=crypto.randomUUID()}={}){
  const {data,error:claimError}=await admin.rpc("claim_shadow_media_retrieval",{p_worker_id:workerId,p_now:now.toISOString()});
  if(claimError)throw claimError;
  const claim=normalizeMediaClaimResult(data,{workerId});
  if(!claim)return null;
  let clearUrl=null;let downloaded=null;
  try{
    if(!MEDIA_ALLOWED_MIME.has(claim.declared_mime))throw Object.assign(new Error("unsupported_media_for_2b1a"),{code:"unsupported_media_for_2b1a"});
    clearUrl=decryptMediaReference(claim,privateKeyPem);
    downloaded=await download(clearUrl,{timeoutMs:10_000});
    const validated=await validateDownloadedMedia(downloaded,{declaredMime:claim.declared_mime});
    const result={retrieval_status:"completed",mime:validated.validatedMime,size:validated.validatedSize,sha256:validated.sha256,pages:validated.pages,attempts:claim.attempts,latency_ms:Date.now()-now.getTime(),completed_at:new Date().toISOString()};
    const {data:completed,error}=await admin.rpc("complete_shadow_media_retrieval",{p_queue_id:claim.id,p_worker_id:workerId,p_result:result});if(error)throw error;if(completed!==true)throw Object.assign(new Error("media_claim_lost"),{code:"media_claim_lost"});
    return{id:claim.id,status:"completed",result};
  }catch(error){
    const code=safeCode(error);const retryable=error?.retryable===true&&claim.attempts<4&&new Date(claim.expires_at)>new Date();
    const next=retryable?new Date(now.getTime()+RETRY_MINUTES[Math.min(claim.attempts-1,RETRY_MINUTES.length-1)]*60_000).toISOString():null;
    const terminalStatus=retryable?"pending":(new Date(claim.expires_at)<=new Date()?"expired":(code==="pending_media_unavailable"?"failed":"rejected"));
    const {data:failed,error:updateError}=await admin.rpc("fail_shadow_media_retrieval",{p_queue_id:claim.id,p_worker_id:workerId,p_error_code:code,p_retry_at:next,p_terminal_status:terminalStatus});if(updateError)throw updateError;if(failed!==true)throw Object.assign(new Error("media_claim_lost"),{code:"media_claim_lost"});
    return{id:claim.id,status:retryable?"pending":(new Date(claim.expires_at)<=new Date()?"expired":"rejected"),error:code};
  }finally{
    clearUrl=null;if(downloaded?.buffer)downloaded.buffer.fill(0);downloaded=null;
  }
}
