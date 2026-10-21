import {DEV} from './facebookDevHealth.js';
import {bridgeOperation} from './bridge.js';
export async function facebookDevPanel(env,authorization,body,fetchImpl=fetch){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='codex/comments-observation-approval'||env.NEXT_PUBLIC_SUPABASE_URL!==DEV)throw Error('isolated_environment');
 const operation=body?bridgeOperation(body):null;
 const r=await fetchImpl(DEV+'/functions/v1/facebook-comments-dev-review',{method:operation?'POST':'GET',headers:{Authorization:authorization,apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,...(operation?{'Content-Type':'application/json'}:{})},...(operation?{body:JSON.stringify(operation)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});
 const d=await r.json();
 if(!r.ok||d?.source!=='facebook_comments_dev'||d.sender!==false||d.private_replies!==false||d.read_only!==false||(!operation&&(!Array.isArray(d.rows)||d.rows.length>200)))throw Error('isolated_review_unavailable');
 return d;
}
