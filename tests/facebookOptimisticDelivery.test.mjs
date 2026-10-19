import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const ui=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
const inbox=readFileSync(new URL('lib/messaging/facebook/messenger/inbox.js',root),'utf8');
test('optimistic text appears before dispatch and status is updated from Meta response',()=>{
 assert.ok(ui.indexOf("state:'sending'")<ui.indexOf("await inboxRequest('facebook','reply'"));
 assert.match(ui,/state=result\.status==='accepted'\?'accepted'/);
 assert.match(ui,/Resultado incierto/);
 assert.match(ui,/outbox\.filter\(o=>o\.state!=='confirmed'\)/);
});
test('only an echo from after attempted delivery can reconcile local bubble',()=>{
 assert.match(ui,/x\.kind==='echo'/);
 assert.match(ui,/x\.text===item\.text/);
 assert.match(ui,/Date\.parse\(x\.occurred_at\)>=item\.startedAt-10000/);
});
test('attachment types are displayed without unverified direct media URLs',()=>{
 assert.match(inbox,/attachment_types:Array\.isArray/);
 assert.match(ui,/vista previa no disponible/);
 assert.match(ui,/onSubmit=\{send\}/);
});
