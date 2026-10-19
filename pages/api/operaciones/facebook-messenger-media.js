import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {messengerConfig,isRef} from '../../../lib/messaging/facebook/messenger/config.js';
import {open,binding} from '../../../lib/messaging/facebook/messenger/crypto.js';
import {reviewMediaUrl} from '../../../lib/messaging/instagram/business/content.js';
import {secureDownload,detectMime} from '../../../lib/shadow/media/network.js';

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
  if(error||!row||row.kind!=='inbound')return res.status(404).end();
  const content=open(c,'content',binding(row),row.content_box);
  stage='attachment_metadata';
  const attachment=Array.isArray(content?.attachments)?content.attachments[index]:null;
  if(!attachment||!['image','audio','video','file'].includes(attachment.type)
   ||typeof attachment.source_url!=='string')return res.status(404).end();
  stage='url_validation';
  const url=reviewMediaUrl(attachment.source_url);
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
 }catch{diagnostic(stage);return res.status(404).end();}
}
