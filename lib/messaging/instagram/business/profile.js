import {openRecipient} from './crypto.js';
import {tokenForSend} from './tokenLifecycle.js';

const clean=x=>typeof x==='string'?x.trim().slice(0,200):null;

export async function resolveBusinessProfile({config:c,history,store,fetchImpl=fetch,now=Date.now()}){
 const inbound=[...(history?.rows||[])].find(e=>e.kind==='inbound'&&e.recipient_box);
 if(!inbound)return null;
 let sender;
 try{sender=openRecipient(c,inbound).sender;}catch{return null;}
 let credential,token;
 try{credential=await store.loadCredential(c.connection);token=tokenForSend(c,credential,now);}catch{return null;}
 try{
  const u=new URL(`https://graph.instagram.com/${c.version}/${sender}`);
  u.searchParams.set('fields','name,username,profile_pic');
  const r=await fetchImpl(u,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  const b=await r.json();
  if(!r.ok||b?.error)return null;
  return {name:clean(b.name),username:clean(b.username),profile_pic:typeof b.profile_pic==='string'&&/^https:\/\//.test(b.profile_pic)?b.profile_pic:null};
 }catch{return null;}
}
