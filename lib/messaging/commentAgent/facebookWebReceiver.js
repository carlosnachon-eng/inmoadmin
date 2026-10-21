import {Buffer} from 'node:buffer';
import {createHash,timingSafeEqual} from 'node:crypto';
import {messengerConfig} from '../facebook/messenger/config.js';
import {captureFacebookComments} from './facebook.js';

// Separate prepared DEV ingress. No Messenger captures or dispatch capability.
export function createFacebookCommentReceiver({env,capture,diagnostic=()=>{}}){
 return async req=>{
  const reply=(status,value)=>new Response(value,{status,headers:{'Cache-Control':'no-store'}});
  let stage='configuration';
  try{
   const vars=env();
   if(vars.FACEBOOK_COMMENTS_DEV_ENABLED!=='true'||vars.VERCEL_ENV!=='development'
    ||vars.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')return reply(404,'disabled');
   const c=messengerConfig(vars);if(!c||c.senderEnabled)return reply(403,'closed');
   if(req.method==='GET'){
    const q=new URL(req.url).searchParams,token=q.get('hub.verify_token'),challenge=q.get('hub.challenge');
    if(q.get('hub.mode')!=='subscribe'||q.getAll('hub.verify_token').length!==1||q.getAll('hub.challenge').length!==1
     ||!token||!timingSafeEqual(createHash('sha256').update(token).digest(),createHash('sha256').update(c.verify).digest())
     ||!/^[A-Za-z0-9_-]{1,128}$/.test(challenge||''))return reply(403,'challenge_denied');
    return reply(200,challenge);
   }
   if(req.method!=='POST')return reply(405,'method_denied');
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||'')||req.headers.has('content-encoding'))return reply(415,'encoding_denied');
   stage='raw_body';const reader=req.body?.getReader();if(!reader)return reply(400,'body_denied');
   const chunks=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return reply(413,'body_denied');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   stage='signature_and_envelope';const rows=captureFacebookComments(Buffer.concat(chunks),req.headers.get('x-hub-signature-256'),c);
   stage='persistence';let inserted=0;
   for(const row of rows){const ack=await capture(c,row);if(![0,1].includes(ack?.inserted))throw Error('ack_denied');inserted+=ack.inserted;}
   diagnostic({stage:'durable_ack',received:rows.length,inserted});return reply(200,'EVENT_RECEIVED');
  }catch(e){const status=e.message==='signature_denied'?403:503;diagnostic({stage,http_status:status});return reply(status,'capture_denied');}
 };
}
