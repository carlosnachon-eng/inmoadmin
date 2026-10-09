import {secureDownload,validateDownloadedMedia,MAX_MEDIA_BYTES} from '../../shadow/media/network.js';
import {decryptMetaMediaId} from './mediaReference.js';

// Fixed Graph endpoint and exact CDN allowlist. Bearer never follows redirects.
export async function retrieveMetaAdminMedia(envelope,{env=process.env,download=secureDownload,pdfParser}={}){
 let metadata,body;
 try{
  const token=env.META_ADMIN_OUTBOUND_ACCESS_TOKEN;
  if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw Error();
  const id=decryptMetaMediaId(envelope.media_ciphertext,envelope,env.META_ADMIN_CAPTURE_ENCRYPTION_KEY);
  metadata=await download(`https://graph.facebook.com/v26.0/${id}?phone_number_id=${envelope.phone_number_id}`,{
   bearerToken:token,allowedHosts:['graph.facebook.com'],maxRedirects:0,maxBytes:65536});
  const info=JSON.parse(metadata.buffer.toString('utf8'));
  if(info.id!==id||typeof info.url!=='string'||!Number.isSafeInteger(info.file_size)||info.file_size<1||info.file_size>MAX_MEDIA_BYTES
    ||!['image/jpeg','image/png','image/webp','application/pdf'].includes(info.mime_type))throw Error();
  const url=new URL(info.url);
  if(url.protocol!=='https:'||url.hostname!=='lookaside.fbsbx.com'||url.username||url.password||url.hash||url.port)throw Error();
  body=await download(url.href,{bearerToken:token,allowedHosts:['lookaside.fbsbx.com'],maxRedirects:0,maxBytes:MAX_MEDIA_BYTES});
  const validated=await validateDownloadedMedia(body,{declaredMime:info.mime_type,pdfParser});
  if(validated.validatedSize!==info.file_size||! /^[a-f0-9]{64}$/i.test(info.sha256||'')||validated.sha256!==info.sha256.toLowerCase())throw Error();
  return {buffer:body.buffer,validated};
 }catch{body?.buffer?.fill(0);throw Error('meta_media_unavailable');}
 finally{metadata?.buffer?.fill(0);}
}
