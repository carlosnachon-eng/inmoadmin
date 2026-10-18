import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../',import.meta.url);
const sql=readFileSync(new URL('supabase/migrations/20261018235500_facebook_messenger_history_recovery.sql',base),'utf8');
const api=readFileSync(new URL('pages/api/operaciones/facebook-messenger-history.js',base),'utf8');
const importer=readFileSync(new URL('lib/messaging/facebook/messenger/historyImport.js',base),'utf8');
test('history recovery is restricted to active admins and same origin',()=>{
 assert.match(api,/sameOriginAdminRequest\(req\)/);
 assert.match(api,/actor\.role_id!=='admin'/);
 assert.match(sql,/p\.role_id='admin'/);
});
test('history path only reads from Meta and never sends messages',()=>{
 assert.match(importer,/method:'GET'/);
 assert.doesNotMatch(importer,/method:'POST'/);
 assert.doesNotMatch(importer,/runManualReply|sendOnce|\/messages\x60,\{/);
 assert.doesNotMatch(sql,/thread_grants|sender_enabled|insert into facebook_messenger_private\.actions/i);
});
test('bounded recovery encrypts events and deduplicates',()=>{
 assert.match(importer,/7\*DAY/);
 assert.match(importer,/\.slice\(0,30\)/);
 assert.match(importer,/\.slice\(0,25\)/);
 assert.match(importer,/seal\(c,'content'/);
 assert.match(importer,/seal\(c,'recipient'/);
 assert.match(sql,/on conflict do nothing/i);
});
