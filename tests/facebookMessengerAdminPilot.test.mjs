import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const base=new URL('../',import.meta.url);
const api=readFileSync(new URL('lib/messaging/facebook/messenger/api.js',base),'utf8');
const inbox=readFileSync(new URL('lib/messaging/facebook/messenger/inbox.js',base),'utf8');
test('Facebook live replies remain admin-only in pilot',()=>{
 assert.match(api,/actor\.role_id!=='admin'/);
 assert.match(api,/!sameOriginAdminRequest\(req\)/);
 assert.match(api,/!c\.senderEnabled/);
 assert.match(inbox,/sender_enabled:actor\.role_id==='admin'&&c\.senderEnabled&&data\.sender_enabled===true/);
});
