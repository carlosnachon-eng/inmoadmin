import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';
import {open,binding,recipient} from '../../../lib/messaging/facebook/messenger/crypto.js';
import {pageToken} from '../../../lib/messaging/facebook/messenger/manual.js';
import {messengerStore} from '../../../lib/messaging/facebook/messenger/store.js';
import {reviewMediaUrl} from '../../../lib/messaging/instagram/business/content.js';
import {secureDownload,detectMime} from '../../../lib/shadow/media/network.js';

// Facebook Messenger's verified CDN host; do not broaden Instagram's allowlist.
function reviewFacebookMediaUrl(value){
 if(typeof value!=='string'||value.length>4096)throw Error('invalid_media_url');
 const u=new URL(value);
 if(u.hostname==='cdn.fbsbx.com'){
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))
   throw Error('invalid_media_url');
  return u.href;
 }
 return reviewMediaUrl(value);
}

// Resolve only the exact, authorized inbound message; never accept a message ID from the browser.
async function recoverSource(c,row,attachment,index,db){
 recipient(c,row); // Validate cryptographic thread/message binding before Graph access.
 const {mid}=open(c,'recipient',binding(row),row.recipient_box);
 const store=messengerStore(db,c.connection,c);
 const token=pageToken(c,await store.credential());
 const endpoint=new URL('https://graph.facebook.com/'+c.version+'/'+encodeURIComponent(mid));
 endpoint.searchParams.set('fields','id,attachments{file_url,image_data,video_data,id}');
 const response=await fetch(endpoint,{method:'GET',redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token}});
 if(!response.ok)throw Error(response.status===401||response.status===403?'graph_access_denied':response.status===404?'graph_not_found':response.status===429?'graph_rate_limited':'graph_http_failure');
 const body=await response.json();
 if(body?.id!==mid)throw Error('graph_message_mismatch');
 if(!Array.isArray(body?.attachments?.data))throw Error('graph_attachments_absent');
 const item=body.attachments.data[index];
 if(!item)throw Error('graph_attachment_index_missing');
 if(typeof attachment.attachment_id==='string'){
  if(item.id!==attachment.attachment_id)throw Error('graph_attachment_mismatch');
 } else {
  // Legacy webhook events may lack an attachment ID. Permit only a unique,
  // type-consistent attachment on the exact cryptographically bound message.
  if(body.attachments.data.length!==1||index!==0)throw Error('legacy_attachment_ambiguous');
  // Graph may omit attachment MIME/type. The existing server-side magic-byte
  // validation below is authoritative for the encrypted recorded media category.
  // Never trust a browser-provided MIME type.
 }
 const candidate=item.file_url||item.image_data?.url||item.image_data?.media_url||item.video_data?.url;
 if(typeof candidate!=='string')throw Error('graph_media_url_missing');
 try{return reviewFacebookMediaUrl(candidate);}catch{
  // Only fixed categories: never log URL, hostname, query, token or message IDs.
  let category='invalid_url';
  try {
   const u=new URL(candidate);
   if(u.protocol!=='https:')category='non_https';
   else if(u.username||u.password||u.hash||(u.port&&u.port!=='443'))category='url_components';
   else if(u.hostname==='lookaside.fbsbx.com'||u.hostname.endsWith('.cdninstagram.com')||
     u.hostname.endsWith('.fbcdn.net'))category='approved_host_rejected';
   else if(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com')||
     u.hostname==='fbsbx.com'||u.hostname.endsWith('.fbsbx.com'))category='meta_host_not_allowlisted';
   else category='other_host_not_allowlisted';
  }catch{}
  throw Error('graph_media_url_rejected_'+category);
 }
}

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 if(req.method!=='GET')return res.status(405).end();
 let stage='config';
 const diagnostic=(label)=>{try{console.info('fb_media_read',{stage:label});}catch{}};
 try{
  const c=messengerConfig(process.env);
  if(!c)return res.status(404).end();
  stage='actor';
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active||!isRef(req.query?.input))return res.status(403).end();
  const index=Number(req.query?.index);
  if(!Number.isInteger(index)||index<0||index>=20)return res.status(400).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  stage='event_read';
  const {data:row,error}=await db.rpc('fb_messenger_read_v1',
   {p_connection:c.connection,p_actor:actor.id,p_input:req.query.input});
  if(error||!row||row.kind!=='inbound'){diagnostic('event_missing_or_forbidden');return res.status(404).end();}
  const content=open(c,'content',binding(row),row.content_box);
  stage='attachment_metadata';
  const attachment=Array.isArray(content?.attachments)?content.attachments[index]:null;
  if(!attachment||!['image','audio','video','file'].includes(attachment.type)){
   diagnostic('attachment_missing');return res.status(404).end();
  }
  stage='url_validation';
  let url;
  if(typeof attachment.source_url==='string')url=reviewFacebookMediaUrl(attachment.source_url);
  else {
   stage='graph_recovery';
   url=await recoverSource(c,row,attachment,index,db);
  }
  const maxBytes=attachment.type==='image'?8*1024*1024:20*1024*1024;
  stage='download';
  const media=await secureDownload(url,{maxBytes,maxRedirects:0,timeoutMs:10000});
  stage='content_validation';
  const mime=detectMime(media.buffer);
  const allowed={
   image:['image/jpeg','image/png','image/webp'],
   audio:['audio/mpeg','audio/ogg','audio/mp4','video/mp4'],
   video:['video/mp4'],
   file:['application/pdf']
  };
  if(!allowed[attachment.type].includes(mime)){diagnostic('unsupported_magic');return res.status(415).end();}
  const responseMime=attachment.type==='audio'&&mime==='video/mp4'?'audio/mp4':mime;
  if(media.headerMime&&media.headerMime!==mime&&media.headerMime!==responseMime
   &&media.headerMime!=='application/octet-stream')
   {diagnostic('mime_mismatch');return res.status(415).end();}
  diagnostic('success');
  res.setHeader('Content-Type',responseMime);
  res.setHeader('Content-Length',String(media.buffer.length));
  res.setHeader('Content-Disposition',attachment.type==='file'?'attachment':'inline');
  return res.status(200).send(media.buffer);
 }catch(error){
  const safe=new Set(['graph_access_denied','graph_not_found','graph_rate_limited','graph_http_failure',
   'graph_message_mismatch','graph_attachments_absent','graph_attachment_index_missing',
   'stored_attachment_id_missing','graph_attachment_mismatch','legacy_attachment_ambiguous',
   'graph_media_url_missing',
   'graph_media_url_rejected',
   'graph_media_url_rejected_invalid_url','graph_media_url_rejected_non_https',
   'graph_media_url_rejected_url_components','graph_media_url_rejected_approved_host_rejected',
   'graph_media_url_rejected_meta_host_not_allowlisted',
   'graph_media_url_rejected_other_host_not_allowlisted']);
  diagnostic(stage==='graph_recovery'&&safe.has(error?.message)?error.message:stage);
  return res.status(404).end();
 }
}
