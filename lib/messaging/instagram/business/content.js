import {createHmac,timingSafeEqual} from 'node:crypto';
import {crc32} from 'node:zlib';
import {detectMime,MAX_MEDIA_BYTES} from '../../../shadow/media/network.js';
const fail=()=>{throw Error('business_media_denied');};
export const MAX_IG_BYTES=262144;
export function verifyInstagramSignature(raw,signature,secret){
 if(!Buffer.isBuffer(raw)||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 return timingSafeEqual(createHmac('sha256',secret).update(raw).digest(),Buffer.from(signature.slice(7),'hex'));
}
export function sanitizeReviewText(value) {
  return typeof value==='string'?value.normalize('NFC').slice(0,4000)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'')
    .replace(/https?:\/\/\S+/gi,'[URL]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g,'[NUMERO]').trim():'';
}
export function reviewMediaUrl(value) {
  if(typeof value!=='string'||value.length>4096)fail();
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')
    ||!(u.hostname==='lookaside.fbsbx.com'||u.hostname.endsWith('.cdninstagram.com')
      ||u.hostname.endsWith('.fbcdn.net')))fail();
  return u.href;
}

export function normalizeReviewImageDownload(result) {
  const b=result.buffer;
  if(result.headerMime!=='image/jpeg'||!Buffer.isBuffer(b)||detectMime(b)!=='image/png')return result;
  if(b.length>MAX_MEDIA_BYTES)fail();
  let offset=8,count=0,hasData=false,ended=false;
  while(offset+12<=b.length){
    const size=b.readUInt32BE(offset),end=offset+12+size;
    if(end>b.length)fail();
    const type=b.toString('ascii',offset+4,offset+8);
    if(crc32(b.subarray(offset+4,end-4))!==b.readUInt32BE(end-4))fail();
    if(count++===0){
      if(type!=='IHDR'||size!==13)fail();
      const width=b.readUInt32BE(offset+8),height=b.readUInt32BE(offset+12);
      if(!width||!height||width*height>16777216)fail();
    }else if(type==='IHDR')fail();
    if(type==='IDAT'&&size>0)hasData=true;
    if(type==='IEND'){if(size!==0||!hasData||end!==b.length)fail();ended=true;break;}
    offset=end;
  }
  if(!ended)fail();
  return {...result,headerMime:'image/png'};
}
