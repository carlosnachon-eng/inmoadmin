// Server-only review core. Not mounted on a route until isolated auth and the
// durable repository have been certified. No in-memory production fallback.
import {createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import https from 'node:https';
import {crc32} from 'node:zlib';
import {instagramObserverConfig, normalizeInstagramObservations, verifyInstagramSignature, MAX_IG_BYTES} from './observer.js';
import {decryptInstagramRecipient} from './manualRecipient.js';
import {instagramInput, instagramManualText, sendInstagramTextOnce, SOCIAL_ACCOUNT, SOCIAL_PAGE} from './manualSender.js';
import {manualUuid} from '../metaAdminInbox/manualValidation.js';
import {secureDownload, validateDownloadedMedia, detectMime, MAX_MEDIA_BYTES} from '../../shadow/media/network.js';

export const REVIEW_ROLE='instagram_review_operator';
const APP='29650489627887372';
const hash=x=>createHash('sha256').update(x).digest('hex');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const native=x=>typeof x==='string'&&/^[A-Za-z0-9_.:=-]{1,512}$/.test(x);
const fail=()=>{throw Error('review_scope_denied');};

export function reviewEnvironment(env) {
  if(env.VERCEL_ENV==='production'||!['preview','development','test'].includes(env.APP_ENV)
    ||env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')fail();
  return true;
}
function contentKey(env) {
  reviewEnvironment(env);
  const k=env.INSTAGRAM_REVIEW_CONTENT_KEY;
  if(!/^[a-f0-9]{64}$/.test(k||'')||[env.INSTAGRAM_MANUAL_RECIPIENT_KEY,
    env.SOCIAL_OAUTH_APP_SECRET,env.INSTAGRAM_OBSERVER_HMAC_KEY].includes(k))fail();
  return Buffer.from(k,'hex');
}
function aad(row) {
  if(!manualUuid(row.campaign_id)||!instagramInput(row.observation_key)
    ||!instagramInput(row.subject_ref)||!instagramInput(row.message_ref)
    ||!native(row.native_id)||!['dm','dm_echo'].includes(row.kind))fail();
  return Buffer.from(JSON.stringify([APP,SOCIAL_PAGE,SOCIAL_ACCOUNT,'instagram_dm',
    row.campaign_id,row.subject_ref,row.message_ref,row.observation_key,row.native_id,row.kind]));
}
function seal(content,row,env) {
  const k=contentKey(env),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',k,iv);
  c.setAAD(aad(row));const ciphertext=Buffer.concat([c.update(JSON.stringify(content),'utf8'),c.final()]);
  return {v:1,iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};
}
export function openReviewContent(row,env) {
  const b=row.content_box;
  if(b?.v!==1||!/^[a-f0-9]{24}$/.test(b.iv)||!/^[a-f0-9]{32}$/.test(b.tag)
    ||!/^(?:[a-f0-9]{2}){1,32768}$/.test(b.ciphertext))fail();
  const d=createDecipheriv('aes-256-gcm',contentKey(env),Buffer.from(b.iv,'hex'));
  d.setAAD(aad(row));d.setAuthTag(Buffer.from(b.tag,'hex'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b.ciphertext,'hex')),d.final()]).toString('utf8'));
}

// Read-only runtime crypto self-check. Fixtures stay in memory, never enter the
// webhook/journal, and are NOT evidence of a real Instagram/media delivery.
export function verifyReviewContentKey(env) {
  const row={campaign_id:'00000000-0000-4000-8000-000000000001',
    observation_key:'1'.repeat(64),subject_ref:'2'.repeat(64),message_ref:'3'.repeat(64),
    native_id:'content-key-self-check',kind:'dm'};
  const sample={text:'Review content encryption self-check',media:[{type:'image',url:'https://lookaside.fbsbx.com/review-content-self-check'}]};
  const bound={...row,content_box:seal(sample,row,env)};
  const decoded=openReviewContent(bound,env);
  let tamperRejected=false;
  try{openReviewContent({...bound,subject_ref:'4'.repeat(64)},env);}catch{tamperRejected=true;}
  const encrypted=JSON.stringify(bound.content_box);
  return {text:decoded.text===sample.text,image_reference:decoded.media[0].url===sample.media[0].url,
    plaintext_absent:!encrypted.includes(sample.text)&&!encrypted.includes(sample.media[0].url),
    tamper_rejected:tamperRejected};
}
// Defense in depth, NOT a claim of automatic full de-identification. Enrollment
// is restricted to controlled test participants using synthetic content.
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

// Enrollment must come from a trusted repository, never from an HTTP body.
// HMAC is independently checked; unknown participants are ignored before any
// text/URL is stored. A new campaign cannot backfill previous observations.
export function captureReviewReceipt({raw,signature,enrollments,env,now=Date.now()}) {
  reviewEnvironment(env);const cfg=instagramObserverConfig(env);
  if(!cfg||!Buffer.isBuffer(raw)||raw.length>MAX_IG_BYTES
    ||!verifyInstagramSignature(raw,signature,cfg.secret))fail();
  const body=JSON.parse(raw.toString('utf8'));
  const normalized=normalizeInstagramObservations(body,cfg);
  const byKey=new Map(normalized.rows.map(r=>[r.observation_key,r]));const result=[];
  for(const entry of body.entry)for(const event of entry.messaging||[]) {
    if(!event.message)continue;
    const kind=event.message.is_echo===true?'dm_echo':'dm';
    const row=byKey.get(hash(stable([cfg.account,kind,event])));if(!row)fail();
    const allowed=enrollments.filter(x=>x.subject_ref===row.subject_ref&&x.active===true
      &&manualUuid(x.campaign_id)&&Number.isFinite(Date.parse(x.starts_at))
      &&Date.parse(x.starts_at)<=Date.parse(row.occurred_at)&&Date.parse(row.occurred_at)<=now
      &&now<Date.parse(x.expires_at));
    if(allowed.length!==1)continue; // ambiguous enrollment cannot grant access
    const campaign=allowed[0],message=event.message;
    const messageRef=createHmac('sha256',cfg.hmac).update(JSON.stringify([APP,SOCIAL_PAGE,
      SOCIAL_ACCOUNT,row.subject_ref,message.mid])).digest('hex');
    const bound={...row,campaign_id:campaign.campaign_id,message_ref:messageRef};
    const deleted=message.is_deleted===true;
    if(message.attachments!==undefined&&!Array.isArray(message.attachments))fail();
    const media=[];
    if(!deleted)for(const attachment of (message.attachments||[]).slice(0,8)) {
      if(attachment?.type==='image') {
        try{media.push({type:'image',url:reviewMediaUrl(attachment.payload?.url)});}
        catch{media.push({type:'unavailable'});}
      } else media.push({type:'unsupported'});
    }
    result.push({...bound,deleted,content_box:seal({text:deleted?'':sanitizeReviewText(message.text),
      media:deleted?[]:media,unsupported:message.is_unsupported===true},bound,env)});
  }
  return {receipt_key:hash(raw),rows:result};
}

// Repository returns tombstones for the COMPLETE requested message scope, not
// just the current page. A deleted event wins even when deliveries are reordered.
export function projectReviewHistory({rows,deletedMessageRefs,env}) {
  if(!Array.isArray(rows)||!(deletedMessageRefs instanceof Set))fail();
  return rows.filter(r=>!r.deleted).sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at))
    .map(r=>{
      const deleted=deletedMessageRefs.has(r.message_ref);
      const content=deleted?{text:'',media:[]}:openReviewContent(r,env);
      return {input:r.observation_key,direction:r.kind==='dm'?'customer_inbound':'business_outbound_unattributed',
        timestamp:r.occurred_at,deleted,text:deleted?'Mensaje anulado':content.text,
        action_status:['reserved','dispatch_started','accepted','failed','uncertain'].includes(r.action_status)?r.action_status:null,
        paused:r.paused===true,
        attachments:content.media.map((m,index)=>({index,type:m.type,state:m.type==='image'?'available':'unavailable'}))};
    });
}

// Meta returned a complete PNG under image/jpeg in the real review receipt.
// Normalize only this exact mismatch, after checking PNG structure/checksums.
// Other MIME mismatches still go through the unchanged shared validator.
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

export async function loadReviewImage({row,index,env,isStillAuthorized,download=secureDownload}) {
  const diagnostic={phase:'authorization',binding_valid:false,http_status:null,content_type:null,bytes:null};
  try {
  if(!Number.isInteger(index)||index<0||!await isStillAuthorized(row))fail();
  diagnostic.phase='decrypt_binding';
  const media=openReviewContent(row,env).media[index];if(media?.type!=='image')fail();
  diagnostic.binding_valid=true;diagnostic.phase='download';
  const result=await download(reviewMediaUrl(media.url),{maxBytes:MAX_MEDIA_BYTES,maxRedirects:0,
    request:(options,callback)=>https.request(options,response=>{
      diagnostic.http_status=Number.isInteger(response.statusCode)?response.statusCode:null;
      const mime=String(response.headers['content-type']||'').split(';',1)[0].toLowerCase();
      diagnostic.content_type=['image/jpeg','image/png','image/webp','application/octet-stream','application/json','text/html'].includes(mime)?mime:'other';
      callback(response);
    })});
  diagnostic.phase='validation';diagnostic.bytes=Buffer.isBuffer(result.buffer)?result.buffer.length:null;
  if(!Buffer.isBuffer(result.buffer)||result.buffer.length>MAX_MEDIA_BYTES)fail();
  diagnostic.detected_mime=detectMime(result.buffer);
  const valid=await validateDownloadedMedia(normalizeReviewImageDownload(result));
  diagnostic.phase='reauthorization';
  if(!['image/jpeg','image/png','image/webp'].includes(valid.validatedMime)||!await isStillAuthorized(row))fail();
  return {buffer:result.buffer,mime:valid.validatedMime}; // authenticated, no-store binary route only
  } catch(error) {
    // Closed enum only: never forward messages, native URLs, headers or tokens.
    const codes=['rejected_network_target','rejected_redirect_target','invalid_media_url','invalid_pinned_address',
      'media_connect_timeout','media_download_timeout','too_many_redirects','pending_media_unavailable',
      'media_http_error','media_too_large','unsupported_or_invalid_magic','mime_mismatch',
      'ENOTFOUND','ECONNRESET','ETIMEDOUT','ERR_INVALID_IP_ADDRESS'];
    diagnostic.reason=codes.includes(error?.code)?error.code:'media_unavailable';
    throw Object.assign(new Error('review_media_unavailable'),{reviewMediaDiagnostic:diagnostic});
  }
}

// Auth adapter must verify the session against its isolated identity provider.
// Identity alone never grants a campaign: membership is fetched each request.
export async function reviewPrincipal({getVerifiedIdentity,store,now=Date.now()}) {
  const identity=await getVerifiedIdentity();
  if(!identity||!manualUuid(identity.id)||typeof identity.issuer!=='string')return null;
  const m=await store.membership(identity.issuer,identity.id);
  if(m?.role!==REVIEW_ROLE||m.active!==true||!manualUuid(m.campaign_id)
    ||!(Date.parse(m.expires_at)>now))return null;
  return {id:identity.id,issuer:identity.issuer,campaign_id:m.campaign_id,role:REVIEW_ROLE};
}

// Real transport is shared with manualSender.js. Repetition means a NEW inbound
// and NEW action, never resetting/reusing a consumed input or uncertain outcome.
export async function runReviewReply({body,principal,store,env,fetchImpl=fetch,now=Date.now}) {
  let reserved=false;
  try {
    reviewEnvironment(env);
    if(!body||Object.keys(body).sort().join(',')!=='action,confirm,input,text'||body.confirm!==true
      ||!instagramInput(body.input)||!manualUuid(body.action)||!instagramManualText(body.text)
      ||principal?.role!==REVIEW_ROLE||!manualUuid(principal.id)||!manualUuid(principal.campaign_id))return {status:'blocked'};
    if(env.INSTAGRAM_REVIEW_SEND_ENABLED!=='true')return {status:'disabled'};
    if(!env.SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN)return {status:'blocked'};
    // store.load/start MUST both recheck live membership, campaign enrollment,
    // tombstones/edits, exact scope, 24h window, and unconsumed input.
    const e=await store.load(principal,body.input);
    const age=now()-Date.parse(e?.occurred_at);
    if(e?.campaign_id!==principal.campaign_id||e?.observation_key!==body.input||e?.deleted!==false
      ||e?.ambiguous!==false||e?.account_id!==SOCIAL_ACCOUNT||e?.page_id!==SOCIAL_PAGE
      ||!Number.isFinite(age)||age<0||age>=86400000)return {status:'blocked'};
    const recipient=decryptInstagramRecipient(e,env);
    const action={principal,input:body.input,action:body.action,text:body.text,lease:randomUUID()};
    reserved=await store.reserveAndPause(action)===true;
    if(!reserved)return {status:'already_consumed_or_blocked'};
    if(await store.start(action)!==true)return {status:'blocked',paused:true};
    const result=await sendInstagramTextOnce({recipient,replyTo:e.native_id,text:body.text,
      accessToken:env.SOCIAL_INSTAGRAM_PAGE_ACCESS_TOKEN,fetchImpl});
    if(await store.finish(action,result)!==true)return {status:'uncertain',paused:true};
    return {status:result.status,paused:true};
  } catch {return {status:reserved?'uncertain':'blocked',...(reserved?{paused:true}:{})};}
}
