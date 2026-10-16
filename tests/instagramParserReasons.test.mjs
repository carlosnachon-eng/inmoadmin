import test from 'node:test';
import assert from 'node:assert/strict';
import {completeBusinessOAuth,businessOAuthDiagnostic} from '../lib/messaging/instagram/business/tokenLifecycle.js';
import {projectOAuthShapeDiagnostic} from '../lib/messaging/instagram/business/diagnosticDisplay.js';
import {PARSER_REASONS} from '../lib/messaging/instagram/business/parserReasons.js';
const valid=()=>({access_token:'PRIVATE_TOKEN',user_id:300,permissions:['instagram_business_basic','instagram_business_manage_messages']});
const cases=[
 ['root_not_object',()=>null],['data_envelope_present',b=>({...b,data:[]})],
 ['error_field_present',b=>({...b,error_type:'PRIVATE_ERROR'})],
 ...['access_token','user_id','permissions'].map(k=>[`${k}_missing`,b=>{delete b[k];return b;}]),
 ['access_token_type',b=>({...b,access_token:123})],['access_token_empty',b=>({...b,access_token:''})],
 ['access_token_whitespace',b=>({...b,access_token:' PRIVATE_TOKEN '})],
 ['user_id_type',b=>({...b,user_id:'PRIVATE_ID'})],
 ['user_id_not_safe_integer',b=>({...b,user_id:Number.MAX_SAFE_INTEGER+1})],
 ['user_id_not_positive',b=>({...b,user_id:0})],
 ['permissions_not_array',b=>({...b,permissions:'PRIVATE_PERMISSION'})],
 ['permissions_empty',b=>({...b,permissions:[]})],
 ['permission_item_type',b=>({...b,permissions:[{permission:'PRIVATE_PERMISSION'}]})],
 ['permission_item_format',b=>({...b,permissions:[' PRIVATE_PERMISSION ']})],
 ['permissions_duplicate',b=>({...b,permissions:[b.permissions[0],b.permissions[0]]})]
];
test('fixtures cover the entire static reason vocabulary',()=>assert.deepEqual(cases.map(([r])=>r).sort(),[...PARSER_REASONS].sort()));
for(const [reason,mutate] of cases)test(`sanitized parser reason ${reason}`,async()=>{
 let calls=0,saves=0;const body=mutate(valid());
 await assert.rejects(()=>completeBusinessOAuth({
  config:{instagramApp:'200',secret:'PRIVATE_SECRET',redirect:'https://example.invalid/callback'},
  state:'a'.repeat(43),code:'PRIVATE_CODE',actor:'operator',sessionBinding:'PRIVATE_SESSION',
  store:{consumeState:async()=>true,saveCredential:async()=>{saves++;}},
  fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>body};}
 }),e=>{
  const d=businessOAuthDiagnostic(e);assert.equal(e.message,'oauth_verification_failed');
  assert.equal(d.stage,'short_token_shape');assert.equal(d.parser_validation,reason);
  const view=projectOAuthShapeDiagnostic(d);assert.equal(view.parser_validation,reason);
  assert.ok(!JSON.stringify(d).includes('PRIVATE'));assert.ok(!JSON.stringify(view).includes('PRIVATE'));
  return true;
 });
 assert.equal(calls,1);assert.equal(saves,0);
});
test('UI rejects arbitrary parser reason text',()=>{
 const d={stage:'short_token_shape',parser_validation:'PRIVATE_TOKEN',short_token_response_shape:{root_type:'object',data_type:'undefined'}};
 assert.ok(!JSON.stringify(projectOAuthShapeDiagnostic(d)).includes('PRIVATE'));
 assert.equal(projectOAuthShapeDiagnostic(d).parser_validation,undefined);
});
