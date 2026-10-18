import {createHash} from 'node:crypto';
import {verifyInstagramSignature,MAX_IG_BYTES,reviewMediaUrl,sanitizeReviewText} from './content.js';
import {PROVIDER,isNative} from './config.js';
import {ref,seal,eventBinding} from './crypto.js';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function normalizeBusinessReceipt(raw,signature,c,mark=()=>{}){
 mark('signature');
 if(!Buffer.isBuffer(raw)||raw.length>MAX_IG_BYTES||!verifyInstagramSignature(raw,signature,c.secret))throw Error('signature_denied');
 mark('json');const body=JSON.parse(raw.toString('utf8'));mark('envelope');if(body.object!=='instagram'||!Array.isArray(body.entry)||!body.entry.length||body.entry.length>100)throw Error('payload_denied');
 const rows=[];let ignored=0;
 for(const entry of body.entry){
  mark('account');
  // Preserve the original short-circuit gate and error; distinguish only its stage.
  mark('account_allowlist');
  if(entry.id!==c.account)throw Error('account_denied');
  mark('messaging_structure');
  if(entry.messaging!==undefined&&!Array.isArray(entry.messaging))throw Error('account_denied');
  // Comments remain out of this DM integration. Never become private threads.
  for(const ev of entry.messaging||[]){
   mark('event_shape');
   if(rows.length>=100)throw Error('batch_denied');const m=ev.message;if(!m){ignored++;continue;}
   const echo=m.is_echo===true,subject=echo?ev.recipient?.id:ev.sender?.id;
   if(!/^\d{1,32}$/.test(subject||'')||subject===c.account||!isNative(m.mid)
    ||(echo?ev.sender?.id:ev.recipient?.id)!==c.account||!Number.isFinite(ev.timestamp)||ev.timestamp<=0)throw Error('scope_denied');
   mark('event_binding');const deleted=m.is_deleted===true,kind=deleted?'unsent':echo?'echo':'inbound';
   const row={provider:PROVIDER,connection_id:c.connection,thread_type:'instagram_dm',kind,deleted,
    subject_ref:ref(c,'subject',subject),thread_ref:ref(c,'thread',subject),message_ref:ref(c,'message',m.mid),
    event_ref:ref(c,'event',canonical(ev)),occurred_at:new Date(ev.timestamp).toISOString()};
   mark('attachments');const media=[];if(m.attachments!==undefined&&!Array.isArray(m.attachments))throw Error('attachments_denied');
   if(!deleted)for(const a of (m.attachments||[]).slice(0,8)){
    if(a?.type!=='image'){media.push({type:'unsupported'});continue;}
    try{media.push({type:'image',url:reviewMediaUrl(a.payload?.url)});}catch{media.push({type:'unavailable'});}
   }
   mark('content_encryption');row.content_box=seal(c,'content',eventBinding(row),{text:deleted?'':sanitizeOperationalText(m.text),media,unsupported:m.is_unsupported===true});
   mark('recipient_encryption');
   row.recipient_box=kind==='inbound'&&!m.is_unsupported&&!m.is_self?seal(c,'recipient',eventBinding(row),{sender:subject,mid:m.mid}):null;
   rows.push(row);
  }
 }
 return {receipt_ref:createHash('sha256').update(raw).digest('hex'),rows,ignored};
}
export async function persistBusinessReceipt({raw,signature,config,store,mark=()=>{}}){
 const p=normalizeBusinessReceipt(raw,signature,config,mark);mark('persistence');const r=await store.capture(p);
 mark('durable_ack');
 if(r?.durable!==true||r.inserted+r.duplicates!==p.rows.length)throw Error('not_durable');
 return {inserted:r.inserted,duplicates:r.duplicates,ignored:p.ignored};
}
