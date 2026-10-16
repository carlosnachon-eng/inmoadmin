import {businessConfig,isRef} from './config.js';
import {persistBusinessReceipt} from './observer.js';
import {createBusinessStore} from './store.js';
import {runBusinessReply} from './manual.js';
import {projectBusinessHistory,loadBusinessImage} from './inbox.js';
import {beginBusinessOAuth,completeBusinessOAuth,businessOAuthDiagnostic,health,maintainBusinessToken} from './tokenLifecycle.js';
import {sameOriginAdminRequest} from '../../../shadow/identityBootstrap.js';
import {createHash,timingSafeEqual} from 'node:crypto';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
export function createBusinessWebhook({getDb,env=()=>process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');let c;try{c=businessConfig(env());}catch{return res.status(503).json({status:'unavailable'});}
  if(!c)return res.status(404).end();
  if(req.method==='GET'){
   if(req.query?.['hub.mode']!=='subscribe'||!equal(req.query?.['hub.verify_token'],c.verify)||!/^\d{1,64}$/.test(req.query?.['hub.challenge']||''))return res.status(403).end();
   return res.status(200).send(req.query['hub.challenge']);
  }
  if(req.method!=='POST')return res.status(405).end();
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return res.status(415).end();
  let raw;try{let n=0;const chunks=[];for await(const v of req){const b=Buffer.from(v);n+=b.length;if(n>262144)return res.status(413).end();chunks.push(b);}raw=Buffer.concat(chunks);
   const result=await persistBusinessReceipt({raw,signature:req.headers['x-hub-signature-256'],config:c,store:createBusinessStore(await getDb(),c.connection)});
   return res.status(200).json(result);
  }catch(e){return res.status(e.message==='signature_denied'?401:503).json({status:'not_acknowledged'});}
 };
}
export function createBusinessInboxApi({authorize,getDb,env=()=>process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const c=businessConfig(env());if(!c)return res.status(404).end();
   const actor=await authorize(req);if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))return res.status(403).json({status:'forbidden'});
   const store=createBusinessStore(await getDb(),c.connection),op=req.query?.op||'threads';
   if(req.method==='POST'){
    if(!sameOriginAdminRequest(req))return res.status(403).json({status:'origin_denied'});
    if(op==='reply')return res.status(200).json(await runBusinessReply({config:c,actor,body:req.body,store,diagnostics:env().VERCEL_ENV==='preview'}));
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
   if(!isRef(req.query.thread))return res.status(400).end();
   const h=await store.history(req.query.thread,actor.id);if(!h)return res.status(403).end();
   if(op==='history')return res.status(200).json({rows:projectBusinessHistory({config:c,...h}),sender_enabled:c.senderEnabled});
   if(op==='media'){
    const row=h.rows.find(e=>e.event_ref===req.query.input);if(!row||h.tombstones.has(row.message_ref))return res.status(404).end();
    const authorized=async e=>{const fresh=await store.history(e.thread_ref,actor.id);return !!fresh&&!fresh.tombstones.has(e.message_ref)&&fresh.rows.some(x=>x.event_ref===e.event_ref);};
    const media=await loadBusinessImage({config:c,row,index:Number(req.query.index),authorized});
    res.setHeader('Content-Type',media.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition','inline');return res.status(200).send(media.buffer);
   }
   return res.status(400).end();
  }catch(e){
   const diagnostic=env().VERCEL_ENV==='preview'&&req.query?.op==='oauth-complete'?businessOAuthDiagnostic(e):null;
   return res.status(503).json(diagnostic?{status:'oauth_verification_failed',diagnostic}:{status:'business_unavailable'});
  }
 };
}
