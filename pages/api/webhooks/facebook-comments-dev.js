import {createClient} from '@supabase/supabase-js';
import {commentObservationAllowed} from '../../../lib/messaging/commentAgent/api.js';
import {captureFacebookComments} from '../../../lib/messaging/commentAgent/facebook.js';
import {messengerConfig} from '../../../lib/messaging/facebook/messenger/config.js';
import {reviewStore} from '../../../lib/messaging/commentAgent/review.js';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!commentObservationAllowed(process.env))return res.status(404).end();
 try{
  const c=messengerConfig(process.env);if(!c)return res.status(503).json({status:'configuration'});
  if(req.method==='GET'){
   if(req.query['hub.mode']!=='subscribe'||req.query['hub.verify_token']!==c.verify||typeof req.query['hub.challenge']!=='string')return res.status(403).end();
   return res.status(200).send(req.query['hub.challenge']);
  }
  if(req.method!=='POST')return res.status(405).end();
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>262144)return res.status(413).end();chunks.push(Buffer.from(chunk));}
  const rows=captureFacebookComments(Buffer.concat(chunks),req.headers['x-hub-signature-256'],c);
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const store=reviewStore(db,'facebook',c,null);for(const row of rows)await store('capture',row);
  return res.status(200).json({status:'durable_ack',events:rows.length});
 }catch(e){return res.status(e.message==='signature_denied'?403:503).json({status:e.message==='signature_denied'?'signature_denied':'capture_unavailable'});}
}
