import {createHash,timingSafeEqual} from 'node:crypto';
import {messengerConfig} from './config.js';
import {captureMessenger} from './observer.js';
import {messengerStore} from './store.js';
import {runManualReply} from './manual.js';
import {sameOriginAdminRequest} from '../../../shadow/identityBootstrap.js';

const equal=(a,b) => typeof a === 'string' && typeof b === 'string'
  && timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
export function createMessengerWebhook({getDb,env=()=>process.env,diagnostic=record=>console.info('facebook_messenger_webhook',record)}) {
  return async(req,res) => {
    res.setHeader('Cache-Control','no-store');
    let stage='configuration';
    const report=status => { try { diagnostic({stage,http_status:status}); } catch {} };
    try {
      const c=messengerConfig(env());
      if (!c) return res.status(404).end();
      if (req.method === 'GET') {
        if (req.query?.['hub.mode'] !== 'subscribe' || !equal(req.query?.['hub.verify_token'],c.verify)
          || typeof req.query?.['hub.challenge'] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(req.query['hub.challenge'])) return res.status(403).end();
        return res.status(200).send(req.query['hub.challenge']);
      }
      if (req.method !== 'POST') return res.status(405).end();
      stage='content_type';
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) return res.status(415).end();
      stage='raw_body'; let size=0; const chunks=[];
      for await (const chunk of req) {
        // Do not reconstruct an object or stringify a body parsed by middleware.
        if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw Error('body_denied');
        size+=chunk.length; if (size > 262144) return res.status(413).end(); chunks.push(chunk);
      }
      stage='validate';
      const captured=captureMessenger(Buffer.concat(chunks),req.headers['x-hub-signature-256'],c);
      stage='persistence';
      const result=await messengerStore(await getDb(),c.connection,c).capture(captured.rows);
      if (result?.received !== captured.rows.length || !Number.isSafeInteger(result.inserted)) throw Error('durable_ack_denied');
      stage='durable_ack'; report(200);
      return res.status(200).json({status:'received',inserted:result.inserted,ignored:captured.ignored});
    } catch(e) {
      const status=e.message === 'signature_denied' ? 401 : 503;
      // Fixed labels only; never exception text, request, payload, IDs or signatures.
      report(status); return res.status(status).json({status:'not_acknowledged'});
    }
  };
}
export function createMessengerManualApi({authorize,getDb,env=()=>process.env}) {
  return async(req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
    try {
      const c=messengerConfig(env()); if (!c) return res.status(404).end();
      if (req.method !== 'POST') return res.status(405).end();
      const actor=await authorize(req);
      if (!actor?.active || !sameOriginAdminRequest(req)) return res.status(403).json({status:'forbidden'});
      // Closed pilot: only Dirección may send. Keep this independent from DB thread grants.
      if(actor.role_id!=='admin')return res.status(403).json({status:'pilot_admin_only'});
      if (!c.senderEnabled) return res.status(200).json({status:'disabled'});
      const result=await runManualReply({config:c,actor,body:req.body,store:messengerStore(await getDb(),c.connection)});
      return res.status(200).json(result);
    } catch { return res.status(503).json({status:'unavailable'}); }
  };
}
