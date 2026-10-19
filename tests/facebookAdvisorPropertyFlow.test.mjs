import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const manualApi=readFileSync(new URL('lib/messaging/facebook/messenger/api.js',root),'utf8');
const inbox=readFileSync(new URL('lib/messaging/facebook/messenger/inbox.js',root),'utf8');
const properties=readFileSync(new URL('pages/api/operaciones/facebook-messenger-properties.js',root),'utf8');
const ui=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
test('Messenger staff sending still requires origin, actor, sender gate and durable SQL authorization',()=>{
 for(const needle of ['sameOriginAdminRequest(req)','COMMERCIAL_INBOX_ROLES.includes(actor.role_id)','!c.senderEnabled','runManualReply'])assert.ok(manualApi.includes(needle));
 assert.ok(inbox.includes('fb_messenger_inbox_v1'));
});
test('Property list requires a readable Messenger thread and published inventory',()=>{
 for(const needle of ['authorizeInboxStaff(req)','fb_messenger_inbox_v1',".eq('status','published')",".not('public_id','is',null)"])assert.ok(properties.includes(needle));
 assert.doesNotMatch(properties,/method:'POST'|sendOnce|service_role.*send/);
});
test('Property selection prepares a reviewable draft rather than sending automatically',()=>{
 assert.ok(ui.includes('openProperties'));
 assert.ok(ui.includes('selectProperty'));
 assert.ok(ui.includes('setText(draft)'));
 assert.ok(ui.includes('onClick={openProperties}'));
 assert.doesNotMatch(ui,/selectProperty\(p\).*inboxRequest/s);
});
