import {createHash,createHmac,createDecipheriv,randomUUID} from 'node:crypto';
import {shadowOnceGate} from './shadowOnce.js';
import {createAdminShadowContextReaders,prepareAdminShadowContext} from './shadowContextReadOnly.js';
import {projectAdminShadowContext} from './shadowContextProjection.js';
import {normalizeIdentityPhone} from '../../shadow/identityBridge.js';

const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SCOPE={waba:'1297760461811288',phone:'1198305790026665'};
const fail=reason=>{throw Error(reason);};
const question=x=>x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!.,]/g,'').trim().replace(/\s+/g,' ');

// Closed grammar, not an LLM risk score. Any extra clause/unknown intent is review.
// We NEVER rewrite an existing proposal: exact equality is mandatory.
export function verifyLowRiskProposal(text,proposal,c){
  if(c?.state!=='ready')return {allowed:false,reason:'context_not_ready'};
  const q=question(text||'');let expected,category;
  if(['recibieron mi mensaje','pueden confirmar la recepcion de mi mensaje'].includes(q)){
    expected='Recibimos tu mensaje.';category='receipt';
  }else if(['cuando vence mi contrato','cual es la fecha de vencimiento de mi contrato'].includes(q)&&c.agreement){
    expected=`La fecha de vencimiento registrada de tu contrato es ${c.agreement.end_date}.`;category='contract_date';
  }else if(['cuando vence mi pago de este mes','cual es la fecha de vencimiento de mi pago de este mes'].includes(q)
    &&c.charges?.items?.length===1){
    expected=`La fecha de vencimiento registrada de tu pago de ${c.charges.period} es ${c.charges.items[0].due_date}.`;category='payment_date';
  }else if(['cual es el estatus registrado de mi pago de este mes'].includes(q)&&c.charges?.items?.length===1){
    expected=`El estatus registrado de tu pago de ${c.charges.period} es ${c.charges.items[0].status}. Esto no acredita conciliación bancaria.`;category='recorded_status';
  }
  return expected&&proposal===expected?{allowed:true,category}:{allowed:false,reason:'unsupported_or_unbacked_proposal'};
}

export function decryptAccreditedRecipient(envelope,input,env){
  const {sender_ciphertext:c,event_key,sender_ref,exact_phone_digest}=envelope;
  if(!/^[a-f0-9]{64}$/.test(env.META_ADMIN_CAPTURE_ENCRYPTION_KEY||'')||!/^[a-f0-9]{64}$/.test(env.META_ADMIN_CAPTURE_HMAC_KEY||''))fail('recipient_keys_unavailable');
  if(c?.v!==1||!/^[a-f0-9]{24}$/.test(c.iv)||!/^[a-f0-9]{32}$/.test(c.tag)||!/^[a-f0-9]{16,30}$/.test(c.data))fail('recipient_unverified');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(env.META_ADMIN_CAPTURE_ENCRYPTION_KEY,'hex'),Buffer.from(c.iv,'hex'));
  decipher.setAAD(Buffer.from(`${input.waba_id}:${input.phone_number_id}:${event_key}`));decipher.setAuthTag(Buffer.from(c.tag,'hex'));
  const to=Buffer.concat([decipher.update(Buffer.from(c.data,'hex')),decipher.final()]).toString('utf8');
  if(!/^[1-9][0-9]{7,14}$/.test(to)||!['signed_from','signed_from_and_wa_id'].includes(envelope.sender_evidence))fail('recipient_unverified');
  const ref=createHmac('sha256',Buffer.from(env.META_ADMIN_CAPTURE_HMAC_KEY,'hex')).update(`${input.waba_id}:${input.phone_number_id}:${to}`).digest('hex');
  const canonical=normalizeIdentityPhone(to);
  if(ref!==sender_ref||ref!==input.subject_ref||!canonical||hash(canonical)!==exact_phone_digest)fail('recipient_unverified');
  return to; // in memory only; never persist/log plaintext address.
}

// No endpoint, webhook, cron or caller is connected in this phase.
// Only the isolated transport journal writes. No model/tool/business capability.
export async function runControlledAdminOutbound({inputId,env=process.env,store,db,now=Date.now,fetchImpl=fetch}){
  if(env.META_ADMIN_CONTROLLED_OUTBOUND_ENABLED!=='true')return {status:'disabled',send_calls:0};
  if(!UUID.test(inputId||'')||inputId!==env.META_ADMIN_CONTROLLED_OUTBOUND_INPUT_ID)return {status:'blocked',reason:'input_not_authorized',send_calls:0};
  let token=randomUUID(),reserved=false,started=false,called=false;
  const review=async reason=>{await store.review(inputId,reason);return {status:'review_required',reason,send_calls:0};};
  try{
    const readers=createAdminShadowContextReaders({db,snapshot:id=>store.snapshot(id),inputId,now});
    async function evidence(){
      const envelope=await store.load(inputId);
      const context=projectAdminShadowContext(await prepareAdminShadowContext({readers,sections:['agreement','charges']}));
      const snapshot=await store.snapshot(inputId),gate=shadowOnceGate(snapshot,now());
      if(!gate.allowed||snapshot.input.id!==inputId||snapshot.identity.state!=='matched')fail('identity_or_attention_blocked');
      const i=snapshot.input,r=envelope?.shadow;
      if(i.waba_id!==SCOPE.waba||i.phone_number_id!==SCOPE.phone)fail('scope_denied');
      const age=now()-Date.parse(i.occurred_at);
      if(!Number.isFinite(age)||age<0||age>=24*3600*1000)fail('service_window_unverified');
      if(!r||r.status!=='complete'||r.identity_state!=='matched'||r.provider!=='openai'||r.model!==env.OPENAI_ADMIN_AGENT_MODEL
        ||r.model_calls!==1||r.send_calls!==0||r.input_fingerprint!==gate.fingerprint)fail('shadow_not_eligible');
      if(!verifyLowRiskProposal(i.sanitized_text,r.proposed_response,context).allowed)fail('unsupported_or_unbacked_proposal');
      const to=decryptAccreditedRecipient(envelope,i,env);
      return {to,body:r.proposed_response,fingerprint:gate.fingerprint,contextHash:hash(context),proposalHash:hash(r.proposed_response),snapshot};
    }
    const first=await evidence();
    if(!env.META_ADMIN_OUTBOUND_ACCESS_TOKEN)fail('sender_token_unavailable');
    reserved=await store.reserve({inputId,token,fingerprint:first.fingerprint,contextHash:first.contextHash,proposalHash:first.proposalHash});
    if(!reserved)return {status:'already_consumed',send_calls:0};
    const second=await evidence();
    if(second.contextHash!==first.contextHash||second.fingerprint!==first.fingerprint||second.proposalHash!==first.proposalHash||second.to!==first.to)fail('context_changed');
    if(!await store.start(inputId,token))fail('claim_lost');
    started=true;
    // Last fresh snapshot after durable dispatch marker, no remote call if stale.
    const last=shadowOnceGate(await store.snapshot(inputId),now());
    if(!last.allowed||last.fingerprint!==first.fingerprint)fail('last_gate_blocked');
    called=true;
    const response=await fetchImpl(`https://graph.facebook.com/v26.0/${SCOPE.phone}/messages`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${env.META_ADMIN_OUTBOUND_ACCESS_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:first.to,type:'text',text:{preview_url:false,body:first.body},context:{message_id:first.snapshot.input.native_message_id}})
    });
    let data;try{data=await response.json();}catch{fail('outcome_uncertain');}
    if(!response.ok){
      if(response.status>=400&&response.status<500&&data?.error&&Number.isInteger(data.error.code)){
        await store.finish(inputId,token,'failed',null);return {status:'failed',send_calls:1};
      }fail('outcome_uncertain');
    }
    const wamid=data?.messages?.length===1?data.messages[0].id:null;
    if(typeof wamid!=='string'||!/^wamid\.[A-Za-z0-9+/=_-]{1,500}$/.test(wamid))fail('outcome_uncertain');
    await store.finish(inputId,token,'accepted',wamid);
    // HTTP accepted is not sent/delivered/read. Existing signed observer is proof.
    return {status:'accepted',send_calls:1};
  }catch{
    if(reserved){await store.finish(inputId,token,started?'uncertain':'review_required',null).catch(()=>{});
      return {status:started?'uncertain':'review_required',send_calls:called?1:0};}
    return review('pre_dispatch_gate_failed');
  }
}
