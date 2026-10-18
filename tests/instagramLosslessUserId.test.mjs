import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJsonWithLosslessUserId as parse} from '../lib/messaging/instagram/business/losslessUserId.js';
import {parseInstagramLoginShortToken,completeBusinessOAuth} from '../lib/messaging/instagram/business/tokenLifecycle.js';
const raw=id=>`{"access_token":"SYNTHETIC_TOKEN","user_id":${id},"permissions":["instagram_business_basic","instagram_business_manage_messages"]}`;
for(const id of ['300','9007199254740991','9007199254740992','9007199254740993','12345678901234567890123456789012'])test(`exact numeric lexeme ${id.length} digits ${id.slice(-2)}`,()=>{
 assert.equal(parseInstagramLoginShortToken(parse(raw(id))).user_id,id);
 assert.equal(parseInstagramLoginShortToken(parse(raw(JSON.stringify(id)))).user_id,id);
});
test('adjacent large IDs never collapse',()=>assert.notEqual(parse(raw('9007199254740992')).user_id,parse(raw('9007199254740993')).user_id));
for(const literal of ['0','-1','1.0','1e3','01','NaN','Infinity','123456789012345678901234567890123','"001"','" 300 "','null','{}'])test(`invalid ID representation ${literal}`,()=>assert.throws(()=>parseInstagramLoginShortToken(parse(raw(literal)))));
for(const text of ['{"user_id":300,"user_id":301}','{"user_id":300,"user_\\u0069d":301}','{"access_token":"a","access_token":"b"}','{"user_id":300,}','PRIVATE_INVALID_JSON'])test('ambiguous/invalid JSON rejected without raw content',()=>assert.throws(()=>parse(text),/^Error: oauth_response_json_invalid$/));
test('escaped keys preserved, embedded key text cannot impersonate a field',()=>{
 assert.equal(parse('{"user_\\u0069d":9007199254740993}').user_id,'9007199254740993');
 const b=parse('{"note":"\\\"user_id\\\": 42", "user_id":9007199254740993}');assert.equal(b.user_id,'9007199254740993');
});
test('real response text consumed once; unsafe ID preserved through OAuth and identity',async()=>{
 const account='9007199254740993';let reads=0,calls=0,saved;
 const config={connection:'fixture',app:'100',instagramApp:'200',account,secret:'SYNTHETIC',tokenKey:'e'.repeat(64),redirect:'https://example.invalid',version:'v26.0'};
 const result=await completeBusinessOAuth({config,state:'a'.repeat(43),code:'SYNTHETIC',actor:'operator',sessionBinding:'fixture',store:{consumeState:async()=>true,saveCredential:async r=>{saved=r;}},fetchImpl:async()=>{
  calls++;const n=calls;
  if(n===3)return {ok:true,json:async()=>({access_token:'SYNTHETIC_LONG',token_type:'bearer',expires_in:5184000})};
  return {ok:true,status:200,text:async()=>{reads++;return n===1?raw(account):`{"user_id":${account}}`;},json:async()=>assert.fail('must not round via response.json()')};
 }});
 assert.equal(result.status,'healthy');assert.equal(reads,3);assert.equal(calls,4);assert.equal(saved.account_id,account);
 assert.ok(!JSON.stringify(saved).includes('SYNTHETIC_LONG'));
});
