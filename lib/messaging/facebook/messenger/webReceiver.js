import {Buffer} from 'node:buffer';
import {createHash,timingSafeEqual} from 'node:crypto';
import {messengerConfig} from './config.js';
import {captureMessenger} from './observer.js';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
// Closed vocabulary only: never log an exception message, body, signature or ID.
const envelopeValidations=new Set(['body_denied','signature_denied','envelope_denied','page_denied','batch_denied','event_denied','message_denied']);

// Public DEV ingress only; independent of Inmoadmin's authenticated UI and sender.
export function createWebReceiver({env,capture,diagnostic=()=>{}}) {
 return async req=>{
  const reply=(status,body='')=>new Response(body,{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain'}});
  let stage='configuration';
  try {
   const c=messengerConfig(env());if(!c)return reply(404);
   if(req.method==='GET'){
    const p=new URL(req.url).searchParams,challenge=p.get('hub.challenge');
    if(p.getAll('hub.verify_token').length!==1||p.getAll('hub.challenge').length!==1||p.get('hub.mode')!=='subscribe'||!equal(p.get('hub.verify_token'),c.verify)||!/^[A-Za-z0-9_-]{1,128}$/.test(challenge||''))return reply(403);
    return reply(200,challenge);
   }
   if(req.method!=='POST')return reply(405);
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||'')||req.headers.has('content-encoding'))return reply(415);
   stage='raw_body';const reader=req.body?.getReader();if(!reader)return reply(400);
   const chunks=[];let size=0;
   try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return reply(413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
   stage='signature_and_envelope';const parsed=captureMessenger(Buffer.concat(chunks),req.headers.get('x-hub-signature-256'),c);
   stage='persistence';const result=await capture(c,parsed.rows);
   if(result?.received!==parsed.rows.length||!Number.isSafeInteger(result.inserted))throw Error('ack_denied');
   diagnostic({stage:'durable_ack',http_status:200});return reply(200,'EVENT_RECEIVED');
  }catch(e){const status=e.message==='signature_denied'?401:503;
   const validation=stage==='signature_and_envelope'
    ? (envelopeValidations.has(e.message)?e.message:e instanceof SyntaxError?'json_invalid':'unclassified')
    : 'unclassified';
   diagnostic({stage,http_status:status,validation});return reply(status);}
 };
}
