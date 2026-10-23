// Server-only, read-only bridge. Never forwards credentials to a client-selected URL.
import {createHash,createPrivateKey,createPublicKey,sign,verify,randomUUID} from 'node:crypto';
import {safeBridgeDiagnostic} from './bridgeDiagnostic.js';
import {associationOperation} from './propertyAssociation.js';
export const BRIDGE_PATH='/api/comment-review-bridge';
export const BRIDGE_AUDIENCE='pr256-instagram-review-read-v1';
export const BRIDGE_BRANCH='codex/comments-observation-approval';
export const DEV_URL='https://hjfwjnejbcpmknvfpdcq.supabase.co';
const digest=x=>createHash('sha256').update(x).digest('hex');
export const bridgeEnvironment=env=>env.VERCEL_ENV==='preview'&&env.NEXT_PUBLIC_SUPABASE_URL===DEV_URL;
function tokenOf(headers){
 const a=headers.authorization;
 if(typeof a!=='string'||a.length>8192||!/^Bearer [A-Za-z0-9._-]+$/.test(a))throw Error('bridge_authentication');
 return a.slice(7);
}
const message=(timestamp,authorization,method,body,nonce)=>Buffer.from(JSON.stringify([BRIDGE_AUDIENCE,method,BRIDGE_PATH,timestamp,digest(authorization),digest(body),nonce]));
export function bridgeOperation(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('bridge_operation');
 if(body.op==='bind_property')return associationOperation(body);
 const keys=Object.keys(body).sort().join(',');
 if(body.op==='evaluate'&&keys==='op')return body;
 if(body.op==='approve'&&keys==='comment,op,revision,text'&&/^[a-f0-9]{64}$/.test(body.comment)&&/^[a-f0-9]{64}$/.test(body.revision)&&typeof body.text==='string'&&body.text.trim()&&body.text.length<=900&&!/[<>\u0000-\u001f]/.test(body.text))return body;
 throw Error('bridge_operation');
}
export function bridgeHeaders(env,authorization,now=Date.now(),method='GET',body='',nonce=''){
 if(!bridgeEnvironment(env)||env.VERCEL_GIT_COMMIT_REF!==BRIDGE_BRANCH)throw Error('bridge_environment');
 tokenOf({authorization});
 const key=createPrivateKey(env.COMMENT_REVIEW_BRIDGE_PRIVATE_KEY);
 if(key.asymmetricKeyType!=='ed25519')throw Error('bridge_configuration');
 const timestamp=String(Math.floor(now/1000));
 return {authorization,'x-review-time':timestamp,'x-review-nonce':nonce,'x-review-signature':sign(null,message(timestamp,authorization,method,body,nonce),key).toString('base64url')};
}
export function verifyBridge(req,env,now=Date.now()){
 if(!bridgeEnvironment(env))throw Error('bridge_environment');
 if(!['GET','POST'].includes(req.method)||req.url!==BRIDGE_PATH)throw Error('bridge_operation');
 const body=req.rawBody||'',nonce=req.headers['x-review-nonce']||'';
 if(req.method==='GET'&&(body||nonce||Number(req.headers['content-length']||0)!==0||req.headers['transfer-encoding']))throw Error('bridge_operation');
 if(req.method==='POST'&&(typeof body!=='string'||Buffer.byteLength(body)>8192||!/^[a-f0-9-]{36}$/.test(nonce)||req.headers['content-type']!=='application/json'))throw Error('bridge_operation');
 const token=tokenOf(req.headers),timestamp=req.headers['x-review-time'],signature=req.headers['x-review-signature'];
 if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(Math.floor(now/1000)-Number(timestamp))>30)throw Error('bridge_expired');
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))throw Error('bridge_signature');
 const key=createPublicKey(env.COMMENT_REVIEW_BRIDGE_PUBLIC_KEY);
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,message(timestamp,req.headers.authorization,req.method,body,nonce),key,Buffer.from(signature,'base64url')))throw Error('bridge_signature');
 if(req.method==='POST')bridgeOperation(JSON.parse(body));
 return token;
}
export async function readThroughBridge(env,authorization,fetchImpl=fetch,oidcToken){
 return throughBridge(env,authorization,null,fetchImpl,oidcToken);
}
export async function writeThroughBridge(env,authorization,body,fetchImpl=fetch,oidcToken){
 return throughBridge(env,authorization,bridgeOperation(body),fetchImpl,oidcToken);
}
async function throughBridge(env,authorization,operation,fetchImpl,oidcToken){
 const url=new URL(env.COMMENT_REVIEW_BRIDGE_URL);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!==BRIDGE_PATH
  ||!/^emporio-instagram-observer-[a-z0-9]+-carlosnachon-engs-projects\.vercel\.app$/.test(url.hostname))throw Error('bridge_destination');
 if(typeof oidcToken!=='string'||!oidcToken||oidcToken.length>16384)throw Error('bridge_oidc_missing');
 const method=operation?'POST':'GET',body=operation?JSON.stringify(operation):'',nonce=operation?randomUUID():'';
 const r=await fetchImpl(url,{method,headers:{...bridgeHeaders(env,authorization,Date.now(),method,body,nonce),'x-vercel-trusted-oidc-idp-token':oidcToken,...(operation?{'Content-Type':'application/json'}:{})},...(operation?{body}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});
 if(!r.ok){
  const error=Error('bridge_remote_unavailable');
  const data=await r.json().catch(()=>null);
  error.diagnostic=safeBridgeDiagnostic(data?.diagnostic);
  throw error;
 }
 const result=await r.json();
 if(result.sender!==false||result.private_replies!==false)throw Error('bridge_response');
 const statuses=operation?.op==='bind_property'?['bound','unchanged','property_unavailable','association_conflict','association_target_denied','event_unavailable']:['evaluated','approved_not_sent','stale_or_blocked','blocked'];
 if(operation?!statuses.includes(result.status):!Array.isArray(result.rows)||result.rows.length>200||result.read_only!==false)throw Error('bridge_response');
 return result;
}
