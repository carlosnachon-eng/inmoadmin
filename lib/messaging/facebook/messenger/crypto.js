import {createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {PROVIDER, CHANNEL, isId, isMid} from './config.js';
const scope = c => [PROVIDER, c.connection, c.app, c.page];
export const ref = (c, purpose, ...parts) => createHmac('sha256', Buffer.from(c.indexKey, 'hex'))
  .update(JSON.stringify([...scope(c), purpose, ...parts])).digest('hex');
const aad = (c,purpose,binding) => Buffer.from(JSON.stringify([...scope(c),purpose,...binding]));
const key = (c,purpose) => hkdfSync('sha256',Buffer.from(purpose === 'token' ? c.tokenKey : c.dataKey,'hex'),PROVIDER,`v1:${purpose}`,32);
export function seal(c,purpose,binding,value) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(c,purpose),iv);
  cipher.setAAD(aad(c,purpose,binding));
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return {v:1,provider:PROVIDER,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')};
}
export function open(c,purpose,binding,box) {
  if (box?.v !== 1 || box.provider !== PROVIDER || !/^[a-f0-9]{24}$/.test(box.iv)
    || !/^[a-f0-9]{32}$/.test(box.tag) || !/^(?:[a-f0-9]{2}){1,65536}$/.test(box.data)) throw Error('cipher_denied');
  const d=createDecipheriv('aes-256-gcm',key(c,purpose),Buffer.from(box.iv,'hex'));
  d.setAAD(aad(c,purpose,binding)); d.setAuthTag(Buffer.from(box.tag,'hex'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data,'hex')),d.final()]).toString('utf8'));
}
export const binding = e => [e.thread_ref,e.message_ref,e.event_ref,new Date(e.occurred_at).toISOString()];
export function recipient(c,e) {
  if (e?.provider !== PROVIDER || e.channel !== CHANNEL || e.connection_id !== c.connection || e.kind !== 'inbound') throw Error('binding_denied');
  const n=open(c,'recipient',binding(e),e.recipient_box);
  if (!isId(n.psid) || n.psid === c.page || !isMid(n.mid)
    || ref(c,'thread',n.psid) !== e.thread_ref || ref(c,'message',n.mid) !== e.message_ref
    || ref(c,'event','inbound',n.mid) !== e.event_ref) throw Error('binding_denied');
  return n.psid;
}
