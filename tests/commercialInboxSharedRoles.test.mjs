import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const policy=readFileSync(new URL('lib/messaging/shared/channelPermissions.js',root),'utf8');
const facebook=readFileSync(new URL('lib/messaging/facebook/messenger/inbox.js',root),'utf8');
const manual=readFileSync(new URL('lib/messaging/facebook/messenger/manual.js',root),'utf8');
const instagram=readFileSync(new URL('lib/messaging/instagram/business/api.js',root),'utf8');
test('both channels use one role contract',()=>{
 assert.match(policy,/COMMERCIAL_INBOX_ROLES/);
 for(const file of [facebook,manual,instagram])assert.match(file,/COMMERCIAL_INBOX_ROLES/);
});
test('Messenger reply retains durable send and permission checks',()=>{
 assert.match(manual,/store\.reserve\(a\)/);
 assert.match(manual,/store\.start\(a\)/);
 assert.match(manual,/recipient\(c,e\)/);
});
test('shared role policy does not activate transport or change grants',()=>{
 assert.doesNotMatch(policy,/fetch\(|supabase|service_role|senderEnabled\s*=/);
});

test('Messenger composer availability follows authorized history and sender gate',()=>{
 assert.match(facebook,/sender_enabled:op==='history'&&c\.senderEnabled&&data\.sender_enabled===true&&roles\.has\(actor\.role_id\)/);
 assert.match(facebook,/fb_messenger_inbox_v1/);
 assert.match(manual,/store\.reserve\(a\)/);
});
