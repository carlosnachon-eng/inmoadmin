import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstagramLoginShortToken} from '../lib/messaging/instagram/business/tokenLifecycle.js';
// Synthetic fixtures only. Source: Meta Business Login, Step 2.
// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
const valid=()=>({data:[{access_token:'fixture-not-a-real-token',user_id:'102000000000001',permissions:'instagram_business_basic,instagram_business_manage_messages'}]});
test('official Instagram Login data envelope accepted, extracts only necessary fields',()=>{
 const b=valid();b.data[0].unused='discard';
 assert.deepEqual(Object.keys(parseInstagramLoginShortToken(b)),['access_token','user_id','permissions']);
});
for(const [name,mutate] of [
 ['missing token',b=>delete b.data[0].access_token],
 ['numeric token',b=>b.data[0].access_token=123],
 ['empty token',b=>b.data[0].access_token=''],
 ['whitespace token',b=>b.data[0].access_token='   '],
 ['missing ID',b=>delete b.data[0].user_id],
 ['numeric ID',b=>b.data[0].user_id=102000000000001],
 ['invalid ID',b=>b.data[0].user_id='not-id'],
 ['missing permissions',b=>delete b.data[0].permissions],
 ['array permissions',b=>b.data[0].permissions=['instagram_business_basic']],
 ['empty permissions',b=>b.data[0].permissions=''],
 ['multiple tokens',b=>b.data.push({...b.data[0]})],
 ['mixed envelope',b=>b.access_token='other-token'],
 ['empty envelope',b=>b.data=[]],
 ['error envelope',b=>b.error_type='OAuthException']
])test(`reject ${name}`,()=>{const b=valid();mutate(b);assert.throws(()=>parseInstagramLoginShortToken(b),/^Error: oauth_verification_failed$/);});
for(const [name,b] of [['null',null],['string','unexpected'],['array',[]],['empty',{}],['flat token',{...valid().data[0]}],['legacy incomplete data',{data:[{access_token:'fixture'}]}]])test(`reject unexpected ${name}`,()=>assert.throws(()=>parseInstagramLoginShortToken(b)));
