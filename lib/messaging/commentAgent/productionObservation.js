// Dedicated, opt-in Production observer. No DM store, sender, OAuth or cron imports.
import * as crypto from './observationCrypto.js';
import {bridgeOperation} from './bridge.js';
import {recordReview,approveReview} from './review.js';
import {projectReviews} from './reviewProjection.js';
import {inspectMetaComment,publicationFacts} from './verifiedPublication.js';
import {bindProperty,readPropertyAssociation} from './propertyAssociation.js';
import {PRODUCTION_DB,productionObservationEnabled} from './observationGate.js';
export {PRODUCTION_DB,productionObservationEnabled};

const native=x=>typeof x==='string'&&/^\d{1,32}(?:_\d{1,32})?$/.test(x);
export function observationConfig(env,platform,now=Date.now()){
 if(!productionObservationEnabled(env)||!['instagram','facebook'].includes(platform))throw Error('observation_environment');
 const prefix='COMMENT_OBSERVATION_'+platform.toUpperCase()+'_',get=n=>env[prefix+n];
 const c={platform,connection:get('CONNECTION_ID'),app:get('APP_ID'),account:get('ACCOUNT_ID'),
  indexKey:get('INDEX_KEY'),dataKey:get('DATA_KEY'),token:get('READ_TOKEN'),senderEnabled:false,
  expiresAt:Number(get('TOKEN_EXPIRES_AT')),posts:JSON.parse(get('POST_IDS')||'null')};
 if(get('MODE')!=='human_review_only'||get('SEND_ENABLED')!=='false'
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(c.connection||'')
  ||![c.app,c.account].every(x=>/^\d{1,32}$/.test(x||''))
  ||![c.indexKey,c.dataKey].every(x=>/^[a-f0-9]{64}$/.test(x||''))||c.indexKey===c.dataKey
  ||typeof c.token!=='string'||!/^[A-Za-z0-9._~-]{20,8192}$/.test(c.token)
 ||typeof get('TOKEN_EXPIRES_AT')!=='string'||!/^\d+$/.test(get('TOKEN_EXPIRES_AT'))||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<0||(c.expiresAt===0&&platform!=='facebook')
  ||(c.expiresAt!==0&&c.expiresAt*1000<=now+60000)
  ||!Array.isArray(c.posts)||c.posts.length<1||c.posts.length>3||!c.posts.every(native)
  ||new Set(c.posts).size!==c.posts.length)throw Error('observation_configuration');
 // Explicit dedicated namespace; never fall back to a transport or DEV key.
 for(const key of ['INSTAGRAM_BUSINESS_CONNECTION_ID','FACEBOOK_MESSENGER_CONNECTION_ID'])if(env[key]===c.connection)throw Error('observation_connection_reuse');
 return Object.freeze(c);
}
const binding=r=>[r.comment_ref,r.post_ref,r.event_ref,new Date(r.occurred_at).toISOString()];
export function snapshot(c,post,node){
 const text=c.platform==='instagram'?node.text:node.message;
 if(!native(post)||!native(node?.id)||typeof text!=='string'||text.length>8000
  ||!Number.isFinite(Date.parse(node.timestamp||node.created_time)))throw Error('observation_source_shape');
 const occurred_at=new Date(node.timestamp||node.created_time).toISOString();
 const row={platform:c.platform,connection_id:c.connection,comment_ref:crypto.ref(c,'comment',node.id),
  post_ref:crypto.ref(c,'post',post),event_ref:crypto.ref(c,'event',node.id,post,occurred_at,text),occurred_at,deleted:false};
 row.content_box=crypto.seal(c,'observed-content',binding(row),{text,origin:'meta_read_v1'});
 row.native_box=crypto.seal(c,'observed-native',binding(row),{comment:node.id,post});
 return row;
}
function decode(c,row){
 const n=crypto.open(c,'observed-native',binding(row),row.native_box),v=crypto.open(c,'observed-content',binding(row),row.content_box);
 if(!native(n.comment)||!native(n.post)||!c.posts.includes(n.post)||crypto.ref(c,'comment',n.comment)!==row.comment_ref
  ||crypto.ref(c,'post',n.post)!==row.post_ref||crypto.ref(c,'event',n.comment,n.post,new Date(row.occurred_at).toISOString(),v.text)!==row.event_ref)throw Error('observation_binding');
 return {native:n,event:{platform:c.platform,connection_ref:crypto.ref(c,'review-connection',c.connection),
  comment_ref:row.comment_ref,post_ref:row.post_ref,event_ref:row.event_ref,occurred_at:row.occurred_at,text:v.text,owned:true,deleted:row.deleted===true}};
}
// Read firewall is independent of caller-supplied fetch. No redirects or retries.
export function observationFetch(c,fetchImpl=fetch){
 const host=c.platform==='instagram'?'graph.instagram.com':'graph.facebook.com';
 const deadline=Date.now()+25000;
 return async(url,options={})=>{
  const u=new URL(url);
  if(options.method!=='GET'||u.origin!==`https://${host}`||u.username||u.password||u.hash
   ||!/^\/v26\.0\/(?:me|\d{1,32}(?:_\d{1,32})?)(?:\/comments)?$/.test(u.pathname)
   ||[...u.searchParams.keys()].some(k=>!['fields','limit','filter'].includes(k)))throw Error('observation_read_only');
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('observation_read_deadline');
  return fetchImpl(u,{method:'GET',headers:{Authorization:`Bearer ${c.token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.min(10000,remaining))});
 };
}
export async function runProductionObservation({env,platform,actor,body=null,db,fetchImpl=fetch}){
 if(!actor?.active||!['admin','gerente_ventas'].includes(actor.role_id))throw Error('observation_forbidden');
 const c=observationConfig(env,platform),operation=body===null?null:bridgeOperation(body),read=observationFetch(c,fetchImpl);
 const rpc=async(op,data={})=>{
  const r=await db.rpc('comment_observation_v1',{p_platform:platform,p_connection:c.connection,p_actor:actor.id,p_op:op,p_data:data});
  if(r.error)throw Error('observation_journal');return r.data;
 };
 const links=(op,data)=>rpc(op==='bind'?'bind_property':'read_property',data);
 const scoped=rows=>{if(!Array.isArray(rows)||rows.length>200||rows.some(r=>r.platform!==platform||r.connection_id!==c.connection))throw Error('observation_scope');return rows;};
 const rows=scoped(await rpc('list')); // DB checks observation-only and sender OFF.
 if(!operation)return {...projectReviews(rows,crypto,c),mode:'human_review_only',source:'production_observation'};
 if(operation.op==='approve')return {...await approveReview({row:rows.find(r=>r.comment_ref===operation.comment&&r.revision===operation.revision),text:operation.text,actor,store:rpc,crypto,c}),sender:false};
 const host=platform==='instagram'?'graph.instagram.com':'graph.facebook.com';
 const get=async(node,fields)=>{const u=new URL(`https://${host}/v26.0/${node}`);u.searchParams.set('fields',fields);if(node.endsWith('/comments')){u.searchParams.set('limit','5');if(platform==='facebook')u.searchParams.set('filter','toplevel');}
  const r=await read(u,{method:'GET'});if(!r.ok)throw Error('observation_meta_read');const d=await r.json();if(d?.error)throw Error('observation_meta_read');return d;};
 const me=await get('me',platform==='instagram'?'user_id':'id');
 if((platform==='instagram'?me.user_id:me.id)!==c.account)throw Error('observation_identity');
 const proofFor=n=>inspectMetaComment({platform,account:c.account,post:n.post,comment:n.comment,token:c.token,fetchImpl:read});
 if(operation.op==='bind_property'){
  const targets=scoped(await rpc('events')).filter(r=>r.comment_ref===operation.comment);
  if(targets.length!==1)throw Error('observation_target');
  const input=decode(c,targets[0]),proof=await proofFor(input.native);
  return {...await bindProperty({operation,row:rows.find(r=>r.comment_ref===operation.comment),event:input.event,proof,c,actor,crypto,links}),sender:false};
 }
 let processed=0,truncated=false;
 for(const post of c.posts){
  // Ownership is verified BEFORE listing or storing any comments.
  const p=await get(post,platform==='instagram'?'id,owner':'id,from');
  if(p.id!==post||(platform==='instagram'?p.owner?.id:p.from?.id)!==c.account)throw Error('observation_owner');
  const edge=await get(post+'/comments',platform==='instagram'?'id,text,timestamp':'id,message,created_time');
  if(!Array.isArray(edge.data)||edge.data.length>5)throw Error('observation_source_shape');
  truncated ||= !!edge.paging?.next;
  for(const node of edge.data){
   const row=snapshot(c,post,node),input=decode(c,row),proof=await proofFor(input.native);
   row.deleted=proof.deleted===true;
   Object.assign(input.event,{replies_verified:proof.replies_verified&&proof.author_verified===true,own_author:proof.own_author,deleted:proof.deleted});
   if(proof.replied)input.event.reply_status='external_reply';
   const captured=await rpc('capture',row);if(![0,1].includes(captured?.inserted))throw Error('observation_capture');
   const association=await readPropertyAssociation({event:input.event,links,crypto,c});
   const facts=await publicationFacts({publication:{verified:true,platform,connection_ref:input.event.connection_ref,post_ref:row.post_ref,text:proof.publicationText},event:input.event,association,db,reference:id=>crypto.ref(c,'property',id)});
   const r=await recordReview({event:input.event,facts,store:rpc,crypto,c});
   if(!['recorded','unchanged'].includes(r?.status))throw Error('observation_evaluation');processed++;
  }
 }
 return {status:'evaluated',processed,truncated,sender:false,private_replies:false,source:'meta_read_v1',webhook_verified:false};
}
