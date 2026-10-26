import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the actual route with injected dependencies, never credentials/network.
const source=readFileSync(new URL('../pages/api/operaciones/comment-review.js',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
async function invoke({sender=false,role='admin',origin='https://preview.test',allowed=true}={}){
 let clients=0;
 const handler=new Function('process','authorizeInboxStaff','commentObservationAllowed','businessConfig','createClient','productionObservationEnabled',source+';return handler;')(
  {env:{}},async()=>({active:true,role_id:role}),()=>allowed,()=>({senderEnabled:sender}),()=>{clients++;throw Error('unexpected_client');},()=>false);
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};
 await handler({method:'POST',headers:{host:'preview.test',origin},query:{platform:'instagram'},body:{op:'evaluate'}},res);
 return{...res,clients};
}
test('direct observation path rejects sender ON before privileged database client',async()=>{
 const r=await invoke({sender:true});assert.equal(r.code,503);assert.equal(r.body.diagnostic.code,'sender_not_closed');assert.equal(r.clients,0);
});
test('unauthorized role, cross-origin and disabled deployment never reach privileged client',async()=>{
 for(const options of [{role:'asesor'},{origin:'https://evil.test'},{allowed:false}]){
  const r=await invoke(options);assert.ok([403,404].includes(r.code));assert.equal(r.clients,0);
 }
});
