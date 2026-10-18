import {businessConfig,isRef} from './config.js';
import {persistBusinessReceipt} from './observer.js';
import {createBusinessStore} from './store.js';
import {runBusinessReply,runBusinessMediaReply} from './manual.js';
import {projectBusinessHistory,loadBusinessMedia} from './inbox.js';
import {beginBusinessOAuth,completeBusinessOAuth,businessOAuthDiagnostic,health,maintainBusinessToken} from './tokenLifecycle.js';
import {sameOriginAdminRequest} from '../../../shadow/identityBootstrap.js';
import {resolveBusinessProfile} from './profile.js';
import {importRecentBusinessHistory} from './historyImport.js';
import {createHash,timingSafeEqual} from 'node:crypto';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
export function createBusinessWebhook({getDb,env=()=>process.env,diagnostic=record=>console.info('instagram_business_webhook_diagnostic',record)}){
 return async(req,res)=>{
  // Request-local fixed labels only. Never log exception text, headers or event data.
  let stage='configuration',hmac=null;
  const stages=new Set(['configuration','content_type','raw_body','body_size','database_client','signature','json','envelope','account','account_allowlist','messaging_structure','event_shape','event_binding','attachments','content_encryption','recipient_encryption','persistence','durable_ack']);
  const mark=s=>{stage=stages.has(s)?s:'unknown';if(s==='signature')hmac=false;if(s==='json')hmac=true;};
  const report=(status,rejected)=>{if(req.method==='POST')try{diagnostic({hmac_valid:hmac,rejection_stage:rejected?stage:null,http_status:status});}catch{/* Observability must not change acknowledgement. */}};
  res.setHeader('Cache-Control','no-store');let c;try{c=businessConfig(env());}catch{report(503,true);return res.status(503).json({status:'unavailable'});}
  if(!c)return res.status(404).end();
  if(req.method==='GET'){
   if(req.query?.['hub.mode']!=='subscribe'||!equal(req.query?.['hub.verify_token'],c.verify)||!/^\d{1,64}$/.test(req.query?.['hub.challenge']||''))return res.status(403).end();
   return res.status(200).send(req.query['hub.challenge']);
  }
  if(req.method!=='POST')return res.status(405).end();
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){mark('content_type');report(415,true);return res.status(415).end();}
  let raw;try{mark('raw_body');let n=0;const chunks=[];for await(const v of req){const b=Buffer.from(v);n+=b.length;if(n>262144){mark('body_size');report(413,true);return res.status(413).end();}chunks.push(b);}raw=Buffer.concat(chunks);
   mark('database_client');const store=createBusinessStore(await getDb(),c.connection);
   const result=await persistBusinessReceipt({raw,signature:req.headers['x-hub-signature-256'],config:c,store,mark});
   report(200,false);
   return res.status(200).json(result);
  }catch(e){const status=e.message==='signature_denied'?401:503;report(status,true);return res.status(status).json({status:'not_acknowledged'});}
 };
}
export function createBusinessInboxApi({authorize,getDb,env=()=>process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const c=businessConfig(env());if(!c)return res.status(404).end();
   const actor=await authorize(req);if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))return res.status(403).json({status:'forbidden'});
   const store=createBusinessStore(await getDb(),c.connection),op=req.query?.op||'threads';
   if(c.production&&!await store.authorizedOperator(actor.id))return res.status(403).json({status:'forbidden'});
   if(req.method==='POST'){
    if(!sameOriginAdminRequest(req)){
     if(op==='reply')console.info('instagram_business_reply_diagnostic',{stage:'origin',status:'blocked'});
     return res.status(403).json({status:'origin_denied'});
    }
    if(op==='reply'){
     const result=await runBusinessReply({config:c,actor,body:req.body,store,diagnostics:true});
     console.info('instagram_business_reply_diagnostic',{stage:result?.diagnostic?.validation||'dispatch',status:result?.status||'unknown'});
     return res.status(200).json(result);
    }
    if(op==='media-reply'){
     const result=await runBusinessMediaReply({config:c,actor,body:req.body,store,diagnostics:true});
     return res.status(200).json(result);
    }
    if(op==='history-sync')return res.status(200).json(await importRecentBusinessHistory({config:c,actor,store}));
    if(op==='alias-set'){
     if(!isRef(req.body?.thread)||typeof req.body?.alias!=='string'||Object.keys(req.body).sort().join(',')!=='alias,thread')return res.status(400).end();
     return res.status(200).json(await store.alias(req.body.thread,actor.id,'set',req.body.alias));
    }
    if(op==='contact-set'){
     if(!isRef(req.body?.thread)||typeof req.body?.phone!=='string'||typeof req.body?.email!=='string'
       ||Object.keys(req.body).sort().join(',')!=='email,phone,thread')return res.status(400).end();
     return res.status(200).json(await store.contact(req.body.thread,actor.id,'set',req.body.phone,req.body.email));
    }
    // Explicit operator maintenance; no sending and no browser token response.
    if(op==='maintain')return res.status(200).json(await maintainBusinessToken({config:c,store}));
    if(op==='oauth-start')return res.status(200).json({url:await beginBusinessOAuth({config:c,actor:actor.id,sessionBinding:req.headers.authorization,store})});
    if(op==='oauth-complete'){
     if(Object.keys(req.body||{}).sort().join(',')!=='code,state')return res.status(400).end();
     return res.status(200).json(await completeBusinessOAuth({config:c,actor:actor.id,sessionBinding:req.headers.authorization,store,...req.body}));
    }
    return res.status(400).end();
   }
   if(req.method!=='GET')return res.status(405).end();
   if(op==='health')return res.status(200).json(health(await store.loadCredential()));
   if(op==='threads')return res.status(200).json({rows:await store.threads(actor.id),sender_enabled:c.senderEnabled});
   if(op==='alias-get'){
    if(!isRef(req.query.thread))return res.status(400).end();
    return res.status(200).json(await store.alias(req.query.thread,actor.id,'get'));
   }
   if(op==='contact-get'){
    if(!isRef(req.query.thread))return res.status(400).end();
    return res.status(200).json(await store.contact(req.query.thread,actor.id,'get'));
   }
   if(!isRef(req.query.thread))return res.status(400).end();
   const h=await store.history(req.query.thread,actor.id);if(!h)return res.status(403).end();
   if(op==='history')return res.status(200).json({rows:projectBusinessHistory({config:c,...h}),sender_enabled:c.senderEnabled,profile:await resolveBusinessProfile({config:c,history:h,store})});
   if(op==='media'){
    const row=h.rows.find(e=>e.event_ref===req.query.input);if(!row||h.tombstones.has(row.message_ref))return res.status(404).end();
    const authorized=async e=>{const fresh=await store.history(e.thread_ref,actor.id);return !!fresh&&!fresh.tombstones.has(e.message_ref)&&fresh.rows.some(x=>x.event_ref===e.event_ref);};
    const media=await loadBusinessMedia({config:c,row,index:Number(req.query.index),authorized});
    res.setHeader('Content-Type',media.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition','inline');return res.status(200).send(media.buffer);
   }
   return res.status(400).end();
  }catch(e){
   const diagnostic=env().VERCEL_ENV==='preview'&&req.query?.op==='oauth-complete'?businessOAuthDiagnostic(e):null;
   const safeHistory=new Set(['history_list_invalid_json','history_list_unavailable','history_detail_invalid_json','history_detail_unavailable','history_message_invalid_json','history_message_unavailable','history_not_durable','history_internal_credential','history_internal_list','history_internal_detail','history_internal_message','history_internal_persist']);
   if(req.query?.op==='history-sync'){
    const status=safeHistory.has(e?.message)?e.message:'history_unknown_stage';
    return res.status(503).json({status});
   }
   return res.status(503).json(diagnostic?{status:'oauth_verification_failed',diagnostic}:{status:'business_unavailable'});
  }
 };
}
