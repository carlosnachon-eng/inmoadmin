import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
const hex=/^[a-f0-9]{64}$/;
const mediaId=/^[1-9][0-9]{0,39}$/;
const fail=()=>{throw Error('media_reference_invalid');};
export function mediaKeyTag(key){if(!hex.test(key||''))fail();return createHmac('sha256',Buffer.from(key,'hex')).update('meta-admin-native-subject-key:v1').digest('hex');}
function aad(binding){
 const {waba_id,phone_number_id,event_key,native_message_id,subject_ref,key_tag}=binding;
 if(waba_id!=='1297760461811288'||phone_number_id!=='1198305790026665'||!event_key||!native_message_id||!hex.test(subject_ref||'')||!hex.test(key_tag||''))fail();
 return Buffer.from(JSON.stringify(['meta-admin-media:v1',waba_id,phone_number_id,event_key,native_message_id,subject_ref,key_tag]));
}
export function encryptMetaMediaId(id,binding,key){
 if(typeof id!=='string'||!mediaId.test(id)||!hex.test(key||''))fail();
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 cipher.setAAD(aad(binding));const data=Buffer.concat([cipher.update(id,'utf8'),cipher.final()]);
 return {v:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')};
}
export function decryptMetaMediaId(ciphertext,binding,key){
 try{
  if(!hex.test(key||'')||ciphertext?.v!==1||!/^[a-f0-9]{24}$/.test(ciphertext.iv)||!/^[a-f0-9]{32}$/.test(ciphertext.tag)||!/^(?:[a-f0-9]{2}){1,40}$/.test(ciphertext.data))fail();
  const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(ciphertext.iv,'hex'));d.setAAD(aad(binding));d.setAuthTag(Buffer.from(ciphertext.tag,'hex'));
  const raw=Buffer.concat([d.update(Buffer.from(ciphertext.data,'hex')),d.final()]);
  try{const id=raw.toString('utf8');if(!mediaId.test(id))fail();return id;}finally{raw.fill(0);}
 }catch{fail();}
}
