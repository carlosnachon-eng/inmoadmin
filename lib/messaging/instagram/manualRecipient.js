import {createCipheriv, createDecipheriv, createHash, createHmac, randomBytes} from 'node:crypto';

const ACCOUNT='17841440384433670';
const APP='29650489627887372',PAGE='119960324707764';
const ref=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:=-]{1,512}$/.test(x);
function key(env) {
  const encoded=env.INSTAGRAM_MANUAL_RECIPIENT_KEY;
  if(typeof encoded!=='string'||!/^[a-f0-9]{64}$/.test(encoded))throw Error('recipient_key_unavailable');
  return Buffer.from(encoded,'hex');
}
function binding(row) {
  if(row.kind!=='dm'||row.provenance!=='customer_inbound'||row.relation_state!=='exact_subject'
    ||!ref(row.observation_key)||!ref(row.subject_ref)||!id(row.native_id))throw Error('recipient_scope_denied');
  const thread=createHash('sha256').update(JSON.stringify([APP,PAGE,ACCOUNT,'instagram_dm',row.subject_ref])).digest('hex');
  if((row.app_id!==undefined&&row.app_id!==APP)||(row.page_id!==undefined&&row.page_id!==PAGE)
    ||(row.account_id!==undefined&&row.account_id!==ACCOUNT)||(row.thread_ref!==undefined&&row.thread_ref!==thread))
    throw Error('recipient_scope_denied');
  return Buffer.from(JSON.stringify([APP,PAGE,ACCOUNT,'instagram_dm',thread,row.observation_key,row.native_id,row.subject_ref]));
}
export function encryptInstagramRecipient(recipient,row,env) {
  if(!/^\d{1,32}$/.test(recipient)||recipient===ACCOUNT)throw Error('recipient_invalid');
  const k=key(env),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',k,iv);
  cipher.setAAD(binding(row));
  const ciphertext=Buffer.concat([cipher.update(recipient,'utf8'),cipher.final()]);
  return {v:1,key_tag:createHash('sha256').update(k).digest('hex').slice(0,16),
    iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};
}
export function decryptInstagramRecipient(row,env) {
  const box=row.recipient_ciphertext,k=key(env);
  if(box?.v!==1||box.key_tag!==createHash('sha256').update(k).digest('hex').slice(0,16)
    ||!/^[a-f0-9]{24}$/.test(box.iv)||!/^[a-f0-9]{32}$/.test(box.tag)
    ||!/^(?:[a-f0-9]{2}){1,32}$/.test(box.ciphertext))throw Error('recipient_unavailable');
  const decipher=createDecipheriv('aes-256-gcm',k,Buffer.from(box.iv,'hex'));
  decipher.setAAD(binding(row));decipher.setAuthTag(Buffer.from(box.tag,'hex'));
  const recipient=Buffer.concat([decipher.update(Buffer.from(box.ciphertext,'hex')),decipher.final()]).toString('utf8');
  if(!/^\d{1,32}$/.test(recipient)||recipient===ACCOUNT||typeof env.INSTAGRAM_OBSERVER_HMAC_KEY!=='string'
    ||createHmac('sha256',env.INSTAGRAM_OBSERVER_HMAC_KEY).update(JSON.stringify([ACCOUNT,recipient])).digest('hex')!==row.subject_ref)
    throw Error('recipient_scope_denied');
  return recipient;
}
