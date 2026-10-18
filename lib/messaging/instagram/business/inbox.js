import {open,eventBinding} from './crypto.js';
import {PROVIDER} from './config.js';
import {reviewMediaUrl,normalizeReviewImageDownload} from './content.js';
import {secureDownload,validateDownloadedMedia,MAX_MEDIA_BYTES,detectMime} from '../../../shadow/media/network.js';
// Repository must supply complete tombstones for the thread, not only this page.
export function projectBusinessHistory({config:c,rows,tombstones}){
 if(!(tombstones instanceof Set))throw Error('tombstones_required');
 return rows.filter(e=>e.kind!=='unsent').map(e=>{
  if(e.provider!==PROVIDER||e.connection_id!==c.connection||e.thread_type!=='instagram_dm')throw Error('history_scope_denied');
  const deleted=tombstones.has(e.message_ref),content=deleted?{text:'Mensaje anulado',media:[]}:open(c,'content',eventBinding(e),e.content_box);
  return {input:e.event_ref,thread_ref:e.thread_ref,thread_type:'instagram_dm',provider:PROVIDER,
   origin:'meta_direct',direction:e.kind==='inbound'?'customer_inbound':e.manual_confirmed?'human_confirmed':'business_outbound_unattributed',
   occurred_at:e.occurred_at,text:content.text,deleted,paused:e.paused===true,status:e.status||null,action_id:e.last_action_id||null,
   attachments:content.media.map((m,index)=>({index,type:m.type,state:['image','audio','video'].includes(m.type)?'available':'unavailable'}))};
 });
}
export async function loadBusinessMedia({config:c,row,index,authorized,download=secureDownload}){
 if(!Number.isInteger(index)||index<0||!await authorized(row))throw Error('media_denied');
 if(row.provider!==PROVIDER||row.connection_id!==c.connection||row.thread_type!=='instagram_dm')throw Error('media_denied');
 const m=open(c,'content',eventBinding(row),row.content_box).media[index];if(!['image','audio','video'].includes(m?.type))throw Error('media_denied');
 const result=await download(reviewMediaUrl(m.url),{maxBytes:MAX_MEDIA_BYTES,maxRedirects:0});
 if(m.type==='audio')console.info('instagram_business_media_probe',{attachment_type:'audio',header_mime:result.headerMime||null,magic_mime:detectMime(result.buffer)||null});
 const normalized=m.type==='image'?normalizeReviewImageDownload(result):result;
 const checked=await validateDownloadedMedia(normalized);
 const allowed=m.type==='image'?['image/jpeg','image/png','image/webp']
  :m.type==='audio'?['audio/mpeg','audio/ogg','audio/mp4','video/mp4']
  :['video/mp4'];
 if(!allowed.includes(checked.validatedMime)||!await authorized(row))throw Error('media_denied');
 const responseMime=m.type==='audio'&&checked.validatedMime==='video/mp4'?'audio/mp4':checked.validatedMime;
 return {buffer:result.buffer,mime:responseMime,type:m.type};
}
// Pilot source selection is an explicit channel mapping, never identity merging.
// Respond remains operational; its historic rows are retained but not duplicated
// into the operational Business Inbox. Unknown sources cannot be silently hidden.
export function pilotInboxRows(rows,{businessEnabled,respondChannelId,accountRef}){
 if(!businessEnabled||typeof respondChannelId!=='string'||!respondChannelId||typeof accountRef!=='string'||!accountRef)return rows;
 return rows.filter(r=>!(r.provider==='respond'&&r.channel_id===respondChannelId&&r.account_ref===accountRef&&r.thread_type==='instagram_dm'));
}
