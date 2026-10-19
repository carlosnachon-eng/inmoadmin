import {createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {PROVIDER,CHANNEL,isId,isMid} from './config.js';
import {ref,seal,binding} from './crypto.js';
import {reviewMediaUrl} from '../../instagram/business/content.js';

// Pure normalization after exact raw-byte authentication; no API calls, replies or AI.
export function captureMessenger(raw,signature,c,onStage=()=>{}) {
  onStage('signature');
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > 262144) throw Error('body_denied');
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)
    || !timingSafeEqual(createHmac('sha256',c.secret).update(raw).digest(),Buffer.from(signature.slice(7),'hex'))) throw Error('signature_denied');
  onStage('json');
  const payload=JSON.parse(raw.toString('utf8'));
  onStage('envelope');
  if (payload?.object !== 'page' || !Array.isArray(payload.entry) || !payload.entry.length || payload.entry.length > 100) throw Error('envelope_denied');
  const rows=[]; let ignored=0;
  for (const entry of payload.entry) {
    onStage('envelope');
    if (entry.id !== c.page) throw Error('page_denied');
    // feed/comments/postbacks are not DMs. Stage 1 does not subscribe to them.
    if (!Array.isArray(entry.messaging)) { ignored++; continue; }
    for (const m of entry.messaging) {
      onStage('normalization');
      if (rows.length >= 100) throw Error('batch_denied');
      const echo=m.message?.is_echo === true;
      if ((echo ? m.sender?.id : m.recipient?.id) !== c.page) throw Error('page_denied');
      const psid=echo ? m.recipient?.id : m.sender?.id;
      if (!isId(psid) || psid === c.page || !Number.isSafeInteger(m.timestamp) || m.timestamp <= 0
        || m.timestamp > 8640000000000000) throw Error('event_denied');
      let kind, mid, content;
      if (m.message) {
        if (!isMid(m.message.mid)) throw Error('message_denied');
        mid=m.message.mid;
        const text=typeof m.message.text === 'string' && Buffer.byteLength(m.message.text,'utf8') <= 16000 ? m.message.text : null;
        // Keep only safe attachment identifiers and type; never persist expiring Meta URLs.
        const attachments=Array.isArray(m.message.attachments)?m.message.attachments.slice(0,20).map(a=>({
          type:['image','audio','video','file'].includes(a?.type)?a.type:'unsupported',
          attachment_id:typeof a?.payload?.attachment_id==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(a.payload.attachment_id)?a.payload.attachment_id:null,
          source_url:(()=>{try{return reviewMediaUrl(a?.payload?.url)}catch{return null}})()
        })):[];
        kind=m.message.is_deleted===true?'deleted':echo?'echo':text!==null||attachments.length?'inbound':'unsupported';
        content={text:kind==='deleted'?null:text,attachment_types:attachments.map(a=>a.type),attachments};
      } else { ignored++; continue; }
      onStage('references');
      const row={provider:PROVIDER,channel:CHANNEL,connection_id:c.connection,
        thread_ref:ref(c,'thread',psid),message_ref:ref(c,'message',mid),event_ref:ref(c,'event',kind,mid),
        kind,occurred_at:new Date(m.timestamp).toISOString()};
      onStage('encryption');
      row.content_box=seal(c,'content',binding(row),content);
      row.recipient_box=kind === 'inbound' ? seal(c,'recipient',binding(row),{psid,mid}) : null;
      rows.push(row);
    }
  }
  return {rows,ignored};
}
