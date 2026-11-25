import {createHmac,createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
const provider='commercial_comments_observation_v1';
const scope=c=>[provider,'production',c.platform,c.connection,c.app,c.account];
const aad=(c,p,b)=>Buffer.from(JSON.stringify([...scope(c),p,...b]));
const key=(c,p)=>Buffer.from(hkdfSync('sha256',Buffer.from(c.dataKey,'hex'),provider,p,32));
export const ref=(c,p,...v)=>createHmac('sha256',Buffer.from(c.indexKey,'hex')).update(aad(c,p,v)).digest('hex');
export function seal(c,p,b,value){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(c,p),iv);cipher.setAAD(aad(c,p,b));
 const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return {v:1,provider,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')};
}
export function open(c,p,b,box){
 if(box?.v!==1||box.provider!==provider||!/^[a-f0-9]{24}$/.test(box.iv)||!/^[a-f0-9]{32}$/.test(box.tag)||!/^(?:[a-f0-9]{2}){1,65536}$/.test(box.data))throw Error('observation_cipher');
 const decipher=createDecipheriv('aes-256-gcm',key(c,p),Buffer.from(box.iv,'hex'));decipher.setAAD(aad(c,p,b));decipher.setAuthTag(Buffer.from(box.tag,'hex'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'hex')),decipher.final()]).toString('utf8'));
}
