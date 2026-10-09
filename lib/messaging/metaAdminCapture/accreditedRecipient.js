import {createHash,createHmac,createDecipheriv} from 'node:crypto';
import {normalizeIdentityPhone} from '../../shadow/identityBridge.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=reason=>{throw Error(reason);};
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
