import {randomUUID} from 'node:crypto';
import {isId,isMid,isRef,isUuid} from './config.js';
import {recipient,open,seal,ref} from './crypto.js';

export const manualText = text => typeof text === 'string' && text.trim() === text && text.length > 0
  && Buffer.byteLength(text,'utf8') <= 1000 && !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069<>]/.test(text);

export function pageToken(c,credential,now=Date.now()) {
  if (credential?.app_id !== c.app || credential.page_id !== c.page || credential.token_type !== 'PAGE'
    || !Array.isArray(credential.scopes) || !credential.scopes.includes('pages_messaging') || !Number.isSafeInteger(credential.generation)
    || credential.generation < 1 || !(Date.parse(credential.valid_until) > now+60000)
    || !(Date.parse(credential.verified_at) <= now && now-Date.parse(credential.verified_at) < 86400000)) throw Error('credential_denied');
  const token=open(c,'token',[credential.generation,credential.valid_until],credential.token_box);
  if (typeof token !== 'string' || !token.length || token.length > 8192) throw Error('credential_denied');
  return token;
}

// Only runManualReply may call the transport after the durable start succeeds.
async function sendOnce(c,psid,text,token,fetchImpl) {
  try {
    const r=await fetchImpl(`https://graph.facebook.com/${c.version}/${c.page}/messages`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_type:'RESPONSE',recipient:{id:psid},message:{text}}),
    });
    const b=await r.json().catch(() => null);
    const integer = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
    if (!r.ok) return {status:r.status >= 400 && r.status < 500 ? 'failed':'uncertain',http_status:r.status,
      code:integer(b?.error?.code),subcode:integer(b?.error?.error_subcode)};
    if (!b || b.error || !isId(b.recipient_id) || b.recipient_id !== psid || !isMid(b.message_id)) return {status:'uncertain',http_status:r.status};
    return {status:'accepted',http_status:r.status,mid:b.message_id};
  } catch { return {status:'uncertain',http_status:null}; }
}

export async function runManualReply({config:c,actor,body,store,fetchImpl=fetch,now=Date.now}) {
  let claimed=false;
  try {
    if (!c?.senderEnabled) return {status:'disabled'};
    if (!actor?.active || !['admin','coord_operaciones','gerente_ventas','asesor','juridico'].includes(actor.role_id)
      || !isUuid(actor.id) || !body || Object.keys(body).sort().join(',') !== 'action,input,text'
      || !isUuid(body.action) || !isRef(body.input) || !manualText(body.text)) return {status:'blocked'};
    const e=await store.input(actor.id,body.input), age=now()-Date.parse(e?.occurred_at);
    if (!e || e.event_ref !== body.input || !Number.isFinite(age) || age < 0 || age >= 23*3600000) return {status:'blocked'};
    const psid=recipient(c,e), credential=await store.credential(), token=pageToken(c,credential,now());
    const a={connection:c.connection,actor:actor.id,input:body.input,action:body.action,lease:randomUUID(),generation:credential.generation,
      text_box:seal(c,'manual-text',[body.action,body.input,actor.id],body.text)};
    claimed=await store.reserve(a) === true;
    if (!claimed) return {status:'already_consumed_or_blocked'};
    // SQL rechecks DB kill-switch, exact thread grant, actor and token freshness.
    // No reset/reclaim operation exists, including after timeout or process death.
    if (!await store.start(a)) return {status:'blocked'};
    const result=await sendOnce(c,psid,body.text,token,fetchImpl);
    const outcome={status:result.status,http_status:result.http_status,code:result.code ?? null,subcode:result.subcode ?? null,
      outbound_ref:result.mid ? ref(c,'message',result.mid) : null,
      outbound_box:result.mid ? seal(c,'outbound',[a.action,a.input],result.mid) : null};
    if (!await store.finish(a,outcome)) return {status:'uncertain'};
    return {status:outcome.status,http_status:outcome.http_status,code:outcome.code,subcode:outcome.subcode};
  } catch { return {status:claimed ? 'uncertain':'blocked'}; }
}
