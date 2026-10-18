import test from 'node:test';
import assert from 'node:assert/strict';
import {completeBusinessOAuth as complete,businessOAuthDiagnostic} from '../lib/messaging/instagram/business/tokenLifecycle.js';
import {withResponseText} from './fixtures/instagramResponseText.mjs';
const completeBusinessOAuth=args=>withResponseText(complete,args);
import {SCOPES} from '../lib/messaging/instagram/business/config.js';
const c={connection:'fixture',app:'100',instagramApp:'200',account:'300',secret:'PRIVATE',tokenKey:'e'.repeat(64),redirect:'https://example.invalid/callback',version:'v26.0'};
const stages=['callback_input','state_validation','short_token_exchange','short_token_shape','granted_scopes','short_token_identity','long_token_exchange','long_token_type_expiry','long_token_identity','credential_encryption','credential_persistence'];
for(const expected of [...stages,'success'])test(expected,async()=>{
 let calls=0,saved;
 const args={config:expected==='credential_encryption'?{...c,tokenKey:undefined}:c,state:expected==='callback_input'?'bad':'a'.repeat(43),code:'PRIVATE',actor:'operator',sessionBinding:'PRIVATE',store:{consumeState:async()=>expected!=='state_validation',saveCredential:async r=>{if(expected==='credential_persistence')throw Error('PRIVATE');saved=r;}},fetchImpl:async()=>{
  calls++;
  if((expected==='short_token_exchange'&&calls===1)||(expected==='long_token_exchange'&&calls===3))return {ok:false,status:400,json:async()=>({error:{code:100,error_subcode:33,message:'PRIVATE',details:'PRIVATE'}})};
  let b=calls===1?{access_token:'PRIVATE',user_id:400,permissions:[...SCOPES]}:calls===3?{access_token:'PRIVATE',token_type:'bearer',expires_in:5184000}:{user_id:c.account};
  if(expected==='short_token_shape'&&calls===1)b={access_token:'PRIVATE'};
  if(expected==='granted_scopes'&&calls===1)b.permissions=['unapproved_scope'];
  if((expected==='short_token_identity'&&calls===2)||(expected==='long_token_identity'&&calls===4))b.user_id='999';
  if(expected==='long_token_type_expiry'&&calls===3)b.expires_in=0;
  return {ok:true,status:200,json:async()=>b};
 }};
 if(expected==='success'){assert.equal((await completeBusinessOAuth(args)).status,'healthy');assert.ok(saved.token_box);assert.ok(!JSON.stringify(saved).includes('PRIVATE'));return;}
 await assert.rejects(()=>completeBusinessOAuth(args),e=>{const d=businessOAuthDiagnostic(e);assert.equal(d.stage,expected);assert.ok(!JSON.stringify(d).includes('PRIVATE'));if(expected.endsWith('_exchange'))assert.deepEqual(d,{stage:expected,http_status:400,code:100,subcode:33});return true;});
 assert.equal(saved,undefined);
});
test('short token shape diagnostic exposes only field names, types and data length',async()=>{
 const args={config:c,state:'a'.repeat(43),code:'PRIVATE',actor:'operator',sessionBinding:'PRIVATE',store:{consumeState:async()=>true,saveCredential:async()=>{}},fetchImpl:async()=>({ok:true,status:200,json:async()=>({data:{access_token:'PRIVATE',user_id:'400',permissions:SCOPES.join(',')},unexpected:'PRIVATE'})})};
 await assert.rejects(()=>completeBusinessOAuth(args),e=>{
  const d=businessOAuthDiagnostic(e);
  assert.equal(d.stage,'short_token_shape');
  assert.deepEqual(d.short_token_response_shape,{
   root_type:'object',
   top_level_keys:['data','unexpected'],
   top_level_types:[{key:'data',type:'object'},{key:'unexpected',type:'string'}],
   data_present:true,
   data_type:'object',
   data_length:null,
   data_items:[]
  });
  assert.ok(!JSON.stringify(d).includes('PRIVATE'));
  assert.ok(!JSON.stringify(d).includes(SCOPES[0]));
  return true;
 });
});
test('arbitrary exception metadata never exported',()=>assert.equal(businessOAuthDiagnostic(Object.assign(Error('PRIVATE'),{diagnostic:{stage:'PRIVATE'}})),null));
