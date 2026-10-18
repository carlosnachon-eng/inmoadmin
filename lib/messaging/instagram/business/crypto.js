import {createHmac,createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {PROVIDER} from './config.js';
export const scope=c=>[PROVIDER,c.connection,c.app,c.instagramApp,c.account];
export const ref=(c,purpose,...parts)=>createHmac('sha256',Buffer.from(c.indexKey,'hex')).update(JSON.stringify([...scope(c),purpose,...parts])).digest('hex');
function aad(c,purpose,binding){return Buffer.from(JSON.stringify([...scope(c),purpose,...binding]));}
function key(c,purpose){return hkdfSync('sha256',Buffer.from(purpose==='token'?c.tokenKey:c.dataKey,'hex'),PROVIDER,`durable-v1:${purpose}`,32);}
export function seal(c,purpose,binding,value){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(c,purpose),iv);cipher.setAAD(aad(c,purpose,binding));
 const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return {v:1,provider:PROVIDER,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')};
}
export function open(c,purpose,binding,box,mark=()=>{}){
 mark(`${purpose}_cipher_envelope`);
 if(box?.v!==1||box.provider!==PROVIDER||!/^[a-f0-9]{24}$/.test(box.iv)||!/^[a-f0-9]{32}$/.test(box.tag)
  ||!/^(?:[a-f0-9]{2}){1,65536}$/.test(box.data))throw Error('business_cipher_denied');
 mark(`${purpose}_cipher_authentication`);
 const d=createDecipheriv('aes-256-gcm',key(c,purpose),Buffer.from(box.iv,'hex'));d.setAAD(aad(c,purpose,binding));d.setAuthTag(Buffer.from(box.tag,'hex'));
 const plaintext=Buffer.concat([d.update(Buffer.from(box.data,'hex')),d.final()]).toString('utf8');
 mark(`${purpose}_plaintext_shape`);return JSON.parse(plaintext);
}
export const eventBinding=e=>[e.thread_ref,e.message_ref,e.event_ref,e.occurred_at];
export function openRecipient(c,e,mark=()=>{}){
 mark('recipient_event_binding');
 if(e.provider!==PROVIDER||e.connection_id!==c.connection||e.thread_type!=='instagram_dm'||e.kind!=='inbound'||e.deleted)throw Error('business_binding_denied');
 const n=open(c,'recipient',eventBinding(e),e.recipient_box,mark);
 mark('recipient_sender_shape');if(!/^\d{1,32}$/.test(n.sender)||n.sender===c.account)throw Error('business_binding_denied');
 mark('recipient_subject_match');if(ref(c,'subject',n.sender)!==e.subject_ref)throw Error('business_binding_denied');
 mark('recipient_thread_match');if(ref(c,'thread',n.sender)!==e.thread_ref)throw Error('business_binding_denied');
 mark('recipient_message_match');if(ref(c,'message',n.mid)!==e.message_ref)throw Error('business_binding_denied');
 return n;
}
