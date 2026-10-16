import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstagramLoginShortToken} from '../lib/messaging/instagram/business/tokenLifecycle.js';
// Synthetic values matching sanitized Preview observation, 2026-10-16.
const valid=()=>({access_token:'fixture-not-a-real-token',user_id:'102000000000001',permissions:['instagram_business_basic','instagram_business_manage_messages']});
test('observed flat response accepted; ID normalized; only needed fields extracted',()=>{
 const b=valid();b.unused='discard';const r=parseInstagramLoginShortToken(b);
 assert.deepEqual(r,{access_token:b.access_token,user_id:'102000000000001',permissions:b.permissions});
 assert.notEqual(r.permissions,b.permissions);
});
for(const [name,mutate] of [
 ['missing token',b=>delete b.access_token],['numeric token',b=>b.access_token=123],
 ['empty token',b=>b.access_token=''],['whitespace token',b=>b.access_token='   '],
 ['padded token',b=>b.access_token=' fixture '],['missing ID',b=>delete b.user_id],
 ['numeric ID without original JSON',b=>b.user_id=102000000000001],['unsafe ID',b=>b.user_id=Number.MAX_SAFE_INTEGER+1],
 ['fractional ID',b=>b.user_id=1.5],['zero ID',b=>b.user_id=0],['negative ID',b=>b.user_id=-1],
 ['infinite ID',b=>b.user_id=Infinity],['NaN ID',b=>b.user_id=NaN],
 ['missing permissions',b=>delete b.permissions],['string permissions',b=>b.permissions='instagram_business_basic'],
 ['empty permissions',b=>b.permissions=[]],['numeric permission',b=>b.permissions=[123]],
 ['object permission',b=>b.permissions=[{permission:'instagram_business_basic'}]],
 ['blank permission',b=>b.permissions=['']],['padded permission',b=>b.permissions=[' instagram_business_basic']],
 ['duplicate permission',b=>b.permissions.push(b.permissions[0])],
 ['mixed envelope',b=>b.data=[valid()]],['null envelope',b=>b.data=null],
 ['error response',b=>b.error={code:100}],['error type',b=>b.error_type='OAuthException']
])test(`reject ${name}`,()=>{const b=valid();mutate(b);assert.throws(()=>parseInstagramLoginShortToken(b),/^Error: oauth_verification_failed$/);});
for(const [name,b] of [['null',null],['string','unexpected'],['array',[]],['empty',{}],['data envelope',{data:[valid()]}],['multiple data entries',{data:[valid(),valid()]}]])test(`reject unexpected ${name}`,()=>assert.throws(()=>parseInstagramLoginShortToken(b)));
