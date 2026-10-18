import {createHash} from 'node:crypto';
import {verifyInstagramSignature,MAX_IG_BYTES,reviewMediaUrl,sanitizeOperationalText} from './content.js';
import {PROVIDER,isNative} from './config.js';
import {ref,seal,eventBinding} from './crypto.js';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function normalizeBusinessReceipt(raw,signature,c,mark=()=>{}){
 mark('signature');
 if(!Buffer.isBuffer(raw)||raw.length>MAX_IG_BYTES||!verifyInstagramSignature(raw,signature,c.secret))throw Error('signature_denied');
 mark('json');const body=JSON.parse(raw.toString('utf8'));mark('envelope');if(body.object!=='instagram'||!Array.isArray(body.entry)||!body.entry.length||body.entry.length>100)throw Error('payload_denied');
 const rows=[],comments=[];let ignored=0;const attachmentTypes=new Set();
 for(const entry of body.entry){
  mark('account');
  // Preserve the original short-circuit gate and error; distinguish only its stage.
  mark('account_allowlist');
  if(entry.id!==c.account)throw Error('account_denied');
  mark('messaging_structure');
  if(entry.messaging!==undefined&&!Array.isArray(entry.messaging))throw Error('account_denied');
  // Comments are persisted separately from DMs and never become private threads.
  if(entry.changes!==undefined&&!Array.isArray(entry.changes))throw Error('account_denied');
  for(const change of entry.changes||[]){
   if(change?.field!=='comments'){ignored++;continue;}
   if(comments.length>=100)throw Error('batch_denied');
   const v=change?.value;
   if(!v||typeof v!=='object'||Array.isArray(v)){ignored++;continue;}
   const commentId=String(v.id||''),mediaId=String(v.media?.id||v.media_id||'');
   if(!/^\d{1,32}$/.test(commentId)||!/^\d{1,32}$/.test(mediaId))throw Error('scope_denied');
   const authorId=String(v.from?.id||'');
   if(authorId&&(!/^\d{1,32}$/.test(authorId)||authorId===c.account)){ignored++;continue;}
   const occurredRaw=v.timestamp||entry.time;
   const occurred=typeof occurredRaw==='string'?Date.parse(occurredRaw):Number(occurredRaw)*1000;
   if(!Number.isFinite(occurred)||occurred<=0)throw Error('scope_denied');
   const comment_ref=ref(c,'comment',commentId),media_ref=ref(c,'media',mediaId);
   const event_ref=ref(c,'comment-event',canonical(change));
   const occurred_at=new Date(occurred).toISOString();
   const binding=[comment_ref,media_ref,event_ref,occurred_at];
   comments.push({
    event_ref,comment_ref,media_ref,occurred_at,
    content_box:seal(c,'comment-content',binding,{
     text:sanitizeOperationalText(v.text),
     username:typeof v.from?.username==='string'?v.from.username:null,
     parent_id:/^\d{1,32}$/.test(String(v.parent_id||''))?String(v.parent_id):null,
     media_product_type:typeof v.media?.media_product_type==='string'?String(v.media.media_product_type).slice(0,40):null
    }),
    native_box:seal(c,'comment-native',binding,{comment_id:commentId,media_id:mediaId,author_id:authorId||null})
   });
  }
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
    const rawType=String(a?.type||'').toLowerCase();
    if(/^[a-z0-9_.:-]{1,80}$/.test(rawType))attachmentTypes.add(rawType);
    if(/^[a-z0-9_.:-]{1,80}$/.test(rawType)){const keys=a?.payload&&typeof a.payload==='object'&&!Array.isArray(a.payload)?Object.keys(a.payload).filter(k=>/^[a-z0-9_.:-]{1,80}$/i.test(k)).sort():[];console.info('instagram_business_attachment_shape',{type:rawType,payload_keys:keys});}
    const type=['image','photo'].includes(rawType)?'image'
      :['audio','voice','voice_message','voice-message'].includes(rawType)?'audio'
      :['video','reel','ig_reel','reels','clip'].includes(rawType)?'video'
      :null;
    if(!type){media.push({type:'unsupported'});continue;}
    try{media.push({type,url:reviewMediaUrl(a.payload?.url)});}catch{media.push({type:'unavailable'});}
   }
   mark('content_encryption');row.content_box=seal(c,'content',eventBinding(row),{text:deleted?'':sanitizeOperationalText(m.text),media,unsupported:m.is_unsupported===true});
   mark('recipient_encryption');
   row.recipient_box=kind==='inbound'&&!m.is_unsupported&&!m.is_self?seal(c,'recipient',eventBinding(row),{sender:subject,mid:m.mid}):null;
   rows.push(row);
  }
 }
 if(attachmentTypes.size)console.info('instagram_business_attachment_types',{types:[...attachmentTypes].sort()});
 return {receipt_ref:createHash('sha256').update(raw).digest('hex'),rows,comments,ignored};
}
export async function persistBusinessReceipt({raw,signature,config,store,mark=()=>{}}){
 const p=normalizeBusinessReceipt(raw,signature,config,mark);mark('persistence');
 const r=await store.capture(p);
 const cr=p.comments.length?await store.captureComments(p.comments):{durable:true,inserted:0,duplicates:0};
 mark('durable_ack');
 if(r?.durable!==true||r.inserted+r.duplicates!==p.rows.length||cr?.durable!==true||cr.inserted+cr.duplicates!==p.comments.length)throw Error('not_durable');
 return {inserted:r.inserted,duplicates:r.duplicates,comments_inserted:cr.inserted,comments_duplicates:cr.duplicates,ignored:p.ignored};
}
