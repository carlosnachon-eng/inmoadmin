import { decryptMediaReference, MEDIA_ALLOWED_MIME } from "./reference.js";
import { secureDownload, validateDownloadedMedia } from "./network.js";
import crypto from "node:crypto";

const RETRY_MINUTES=[1,3,8,16];
const safeCode=(error)=>String(error?.code||"media_retrieval_failed").replace(/[^a-z0-9_]/g,"").slice(0,80)||"media_retrieval_failed";

export async function processOneMediaRetrieval(admin,{privateKeyPem=process.env.SHADOW_MEDIA_RETRIEVAL_PRIVATE_KEY,download=secureDownload,now=new Date(),workerId=crypto.randomUUID()}={}){
  const {data:claim,error:claimError}=await admin.rpc("claim_shadow_media_retrieval",{p_worker_id:workerId,p_now:now.toISOString()});
  if(claimError)throw claimError;if(!claim)return null;
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
