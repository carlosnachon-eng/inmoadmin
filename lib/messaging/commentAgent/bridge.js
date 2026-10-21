// Server-only, read-only bridge. Never forwards credentials to a client-selected URL.
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
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
const message=(timestamp,authorization)=>Buffer.from(JSON.stringify([BRIDGE_AUDIENCE,'GET',BRIDGE_PATH,timestamp,digest(authorization)]));
export function bridgeHeaders(env,authorization,now=Date.now()){
 if(!bridgeEnvironment(env)||env.VERCEL_GIT_COMMIT_REF!==BRIDGE_BRANCH)throw Error('bridge_environment');
 tokenOf({authorization});
 const key=createPrivateKey(env.COMMENT_REVIEW_BRIDGE_PRIVATE_KEY);
 if(key.asymmetricKeyType!=='ed25519')throw Error('bridge_configuration');
 const timestamp=String(Math.floor(now/1000));
 return {authorization,'x-review-time':timestamp,'x-review-signature':sign(null,message(timestamp,authorization),key).toString('base64url')};
}
export function verifyBridge(req,env,now=Date.now()){
 if(!bridgeEnvironment(env))throw Error('bridge_environment');
 if(req.method!=='GET'||req.url!==BRIDGE_PATH||Number(req.headers['content-length']||0)!==0||req.headers['transfer-encoding'])throw Error('bridge_operation');
 const token=tokenOf(req.headers),timestamp=req.headers['x-review-time'],signature=req.headers['x-review-signature'];
 if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(Math.floor(now/1000)-Number(timestamp))>30)throw Error('bridge_expired');
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))throw Error('bridge_signature');
 const key=createPublicKey(env.COMMENT_REVIEW_BRIDGE_PUBLIC_KEY);
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,message(timestamp,req.headers.authorization),key,Buffer.from(signature,'base64url')))throw Error('bridge_signature');
 return token;
}
export async function readThroughBridge(env,authorization,fetchImpl=fetch,oidcToken){
 const url=new URL(env.COMMENT_REVIEW_BRIDGE_URL);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!==BRIDGE_PATH
  ||!/^emporio-instagram-observer-[a-z0-9]+-carlosnachon-engs-projects\.vercel\.app$/.test(url.hostname))throw Error('bridge_destination');
 if(typeof oidcToken!=='string'||!oidcToken||oidcToken.length>16384)throw Error('bridge_oidc_missing');
 const r=await fetchImpl(url,{method:'GET',headers:{...bridgeHeaders(env,authorization),'x-vercel-trusted-oidc-idp-token':oidcToken},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('bridge_remote_unavailable');
 const result=await r.json();
 if(!Array.isArray(result.rows)||result.rows.length>200||result.sender!==false||result.private_replies!==false||result.read_only!==true)throw Error('bridge_response');
 return result;
}
