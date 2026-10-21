import {createHmac} from 'node:crypto';
import {open} from '../facebook/messenger/crypto.js';
import {inspectPageToken} from '../facebook/messenger/provisioning.js';

// Read-only diagnostic, not a credential renewal or sender freshness bypass.
// No persistence capability is accepted; native IDs/content never leave this function.
export async function diagnoseFacebookRead({c,credential,fetchImpl=fetch,now=Date.now()}){
 const base={sender:false,private_replies:false,credential_saved:false,dispatches:0};
 let stage='credential_binding';
 const result=(status,extra={})=>({...base,status,stage,...extra});
 try{
  if(!c||c.senderEnabled||credential?.app_id!==c.app||credential?.page_id!==c.page
   ||credential.token_type!=='PAGE'||!Number.isSafeInteger(credential.generation)||credential.generation<1
   ||!Number.isFinite(Date.parse(credential.valid_until)))return result('blocked');
  const token=open(c,'token',[credential.generation,credential.valid_until],credential.token_box);
  stage='token_introspection';
  const verified=await inspectPageToken(c,token,{fetchImpl,now});
  if(!verified.ok)return result('blocked',{stage:verified.stage,http_status:verified.http_status??null,code:verified.code??null,subcode:verified.subcode??null});
  const metadata={identity_verified:true,app_verified:true,scopes:verified.scopes,
   meta_non_expiring:verified.meta_non_expiring,expires_at:verified.expires_at,data_access_expires_at:verified.data_access_expires_at,
   subscribed_fields:verified.subscribed_fields,stored_lease_fresh:Date.parse(credential.valid_until)>now&&Date.parse(credential.verified_at)<=now&&now-Date.parse(credential.verified_at)<86400000};
  if(!verified.scopes.includes('pages_read_engagement'))return result('blocked',{...metadata,stage:'read_permissions',missing_scopes:['pages_read_engagement']});
  const get=async(path,params)=>{
   const u=new URL(`https://graph.facebook.com/${c.version}/${path}`);
   for(const [key,value] of Object.entries(params))u.searchParams.set(key,value);
   u.searchParams.set('appsecret_proof',createHmac('sha256',c.secret).update(token).digest('hex'));
   const r=await fetchImpl(u,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   const b=await r.json();
   if(!r.ok||b?.error)return {error:{http_status:r.status,code:Number.isSafeInteger(b?.error?.code)?b.error.code:null,subcode:Number.isSafeInteger(b?.error?.error_subcode)?b.error.error_subcode:null}};
   return {body:b,http_status:r.status};
  };
  stage='page_posts';
  const posts=await get(`${c.page}/posts`,{fields:'id,from',limit:'1'});
  if(posts.error)return result('blocked',{...metadata,...posts.error});
  if(!Array.isArray(posts.body?.data)||posts.body.data.length>1)return result('blocked',{...metadata,diagnostic:'posts_shape'});
  if(!posts.body.data.length)return result('no_post_in_sample',metadata);
  const post=posts.body.data[0];
  if(typeof post.id!=='string'||!post.id.startsWith(c.page+'_')||!/^\d+_\d+$/.test(post.id)||post.from?.id!==c.page)return result('blocked',{...metadata,diagnostic:'post_binding'});
  const evidence={...metadata,post_read:true,post_http_status:posts.http_status,post_owner_verified:true};
  if(!verified.scopes.includes('pages_read_user_content'))return result('blocked',{...evidence,stage:'comment_read_permissions',missing_scopes:['pages_read_user_content']});
  stage='post_comments';
  const comments=await get(`${post.id}/comments`,{fields:'id,parent',filter:'toplevel',limit:'1'});
  if(comments.error)return result('blocked',{...evidence,...comments.error});
  if(!Array.isArray(comments.body?.data)||comments.body.data.length>1)return result('blocked',{...evidence,diagnostic:'comments_shape'});
  if(!comments.body.data.length)return result('no_comment_in_sample',{...evidence,comments_http_status:comments.http_status});
  const comment=comments.body.data[0];
  if(typeof comment.id!=='string'||!/^\d+(?:_\d+)?$/.test(comment.id)||comment.parent?.id!==post.id)return result('blocked',{...evidence,diagnostic:'comment_binding'});
  return result('read_pass',{...evidence,comment_read:true,comment_post_verified:true,comments_http_status:comments.http_status});
 }catch{return result('blocked',{diagnostic:'transport_or_contract_failure'});}
}
