import {createHmac,timingSafeEqual} from 'node:crypto';
import {manualUuid} from '../metaAdminInbox/manualValidation.js';
import {instagramManualText,runInstagramManualReply,SOCIAL_ACCOUNT,SOCIAL_PAGE} from './manualSender.js';
import {decryptInstagramRecipient} from './manualRecipient.js';

export const DEV_INPUT='657d0f0fbf4c935a927067aff8bd552e6825c67677bd83eadbf0fbcfbd02c306';
export const RELAY_URL='https://emporio-instagram-observer-dev-carlosnachon-engs-projects.vercel.app/api/manual/relay';
export const DEV_DB='https://hjfwjnejbcpmknvfpdcq.supabase.co';
export const MAIN_PROJECT='prj_3ifckz8Vgls6jnODt6t4V44jjPVP';
export const RECEIVER_PROJECT='prj_SaVgfFB5j4ucvmmQXqAOBkXBnc9Q';
const admin=a=>a?.active===true&&a.role_id==='admin'&&manualUuid(a.id);
export function relayEnabled(env,project,now=Date.now()) {
  const deadline=Date.parse(env.INSTAGRAM_MANUAL_RELAY_EXPIRES_AT);
  return env.VERCEL_ENV==='preview'&&env.VERCEL_PROJECT_ID===project
    &&env.NEXT_PUBLIC_SUPABASE_URL===DEV_DB&&env.INSTAGRAM_MANUAL_RELAY_ENABLED==='true'
    &&/^[a-f0-9]{64}$/.test(env.INSTAGRAM_MANUAL_RELAY_SECRET||'')
    &&Number.isFinite(deadline)&&deadline>now&&deadline-now<=24*60*60*1000;
}
function validBody(b) {
  return b&&Object.keys(b).sort().join(',')==='action,actor,input,issued_at,op,text,v'
    &&b.v===1&&b.input===DEV_INPUT&&manualUuid(b.actor)&&Number.isSafeInteger(b.issued_at)
    &&(['preflight','status'].includes(b.op)?b.action===null&&b.text===null
      :b.op==='send'&&manualUuid(b.action)&&instagramManualText(b.text));
}
export function signRelay(body,secret) {
  if(!validBody(body)||!/^[a-f0-9]{64}$/.test(secret||''))throw Error('relay_denied');
  return createHmac('sha256',Buffer.from(secret,'hex')).update('instagram-manual-dev-v1\n'+JSON.stringify(body)).digest('hex');
}
export function verifyRelay(body,signature,secret,now=Date.now()) {
  if(!validBody(body)||!Number.isSafeInteger(now)||body.issued_at>now||now-body.issued_at>10000
    ||!/^[a-f0-9]{64}$/.test(signature||''))return false;
  try{return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(signRelay(body,secret),'hex'));}catch{return false;}
}
// Closed projection: never relay native IDs, ciphertext, text, actor or errors from upstream.
export function safeRelayResult(r) {
  const statuses=['ready','disabled','blocked','not_consumed','accepted','failed','uncertain','pending','already_consumed_or_blocked'];
  const out={status:statuses.includes(r?.status)?r.status:'blocked'};
  for(const k of ['binding_verified','authorized','no_prior_claim','sender_enabled','paused'])if(typeof r?.[k]==='boolean')out[k]=r[k];
  if(typeof r?.occurred_at==='string'&&Number.isFinite(Date.parse(r.occurred_at)))out.occurred_at=new Date(r.occurred_at).toISOString();
  if(['sent','delivered','read'].includes(r?.delivery_status))out.delivery_status=r.delivery_status;
  return out;
}
export async function receiveManualRelay({body,signature,env,store,loadActor,fetchImpl,now=Date.now}) {
  if(!relayEnabled(env,RECEIVER_PROJECT,now()))return {status:'disabled'};
  if(!verifyRelay(body,signature,env.INSTAGRAM_MANUAL_RELAY_SECRET,now()))return {status:'blocked'};
  try {
    const actor=await loadActor(body.actor);
    if(!admin(actor)||actor.id!==body.actor)return {status:'blocked'};
    if(body.op==='status')return safeRelayResult(await store.status(DEV_INPUT,actor.id));
    const row=await store.load(DEV_INPUT,actor.id),age=now()-Date.parse(row?.occurred_at);
    if(row?.observation_key!==DEV_INPUT||row?.account_id!==SOCIAL_ACCOUNT||row?.page_id!==SOCIAL_PAGE
      ||!Number.isFinite(age)||age<0||age>=86400000)return {status:'blocked'};
    decryptInstagramRecipient(row,env); // Exact authenticated binding, result never leaves server.
    const journal=await store.status(DEV_INPUT,actor.id);
    const noClaim=journal?.status==='not_consumed';
    if(body.op==='preflight')return {status:noClaim?'ready':'already_consumed_or_blocked',binding_verified:true,
      authorized:true,no_prior_claim:noClaim,sender_enabled:env.INSTAGRAM_MANUAL_REPLY_ENABLED==='true'
        &&env.INSTAGRAM_MANUAL_AUTHORIZED_INPUT===DEV_INPUT,occurred_at:row.occurred_at};
    if(!noClaim)return {status:'already_consumed_or_blocked'};
    // Recheck expiry after reads; runner repeats binding/gates and consumes durable unique claim.
    if(!verifyRelay(body,signature,env.INSTAGRAM_MANUAL_RELAY_SECRET,now()))return {status:'blocked'};
    return safeRelayResult(await runInstagramManualReply({input:DEV_INPUT,action:body.action,text:body.text,actor,store,env,fetchImpl,now}));
  }catch{return {status:body?.op==='send'?'uncertain':'blocked'};}
}

export function createManualRelayClient({authorize,env=process.env,fetchImpl=fetch,now=Date.now}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!relayEnabled(env,MAIN_PROJECT,now()))return res.status(404).json({status:'disabled'});
    if(!['GET','POST'].includes(req.method))return res.status(405).json({status:'blocked'});
    try {
      const actor=await authorize(req);
      if(!admin(actor))return res.status(403).json({status:'blocked'});
      let op,action=null,text=null;
      if(req.method==='GET') {
        if(Object.keys(req.query||{}).join(',')!=='op'||!['preflight','status'].includes(req.query.op))return res.status(400).json({status:'blocked'});
        op=req.query.op;
      }else{
        if(req.headers.origin!==`https://${env.VERCEL_URL}`||req.headers.host!==env.VERCEL_URL
          ||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')
          ||Object.keys(req.query||{}).length||!req.body||Object.keys(req.body).sort().join(',')!=='action,text'
          ||!manualUuid(req.body.action)||!instagramManualText(req.body.text))return res.status(400).json({status:'blocked'});
        op='send';({action,text}=req.body);
      }
      const body={v:1,op,input:DEV_INPUT,actor:actor.id,action,text,issued_at:now()};
      const response=await fetchImpl(RELAY_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
        headers:{'Content-Type':'application/json','x-instagram-dev-signature':signRelay(body,env.INSTAGRAM_MANUAL_RELAY_SECRET)},body:JSON.stringify(body)});
      if(!response.ok)return res.status(503).json({status:op==='send'?'uncertain':'blocked'});
      return res.status(200).json(safeRelayResult(await response.json()));
    }catch{return res.status(503).json({status:req.method==='POST'?'uncertain':'blocked'});}
  };
}
