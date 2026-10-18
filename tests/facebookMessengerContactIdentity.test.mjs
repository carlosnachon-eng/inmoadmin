import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const importer=readFileSync(new URL('lib/messaging/facebook/messenger/historyImport.js',root),'utf8');
const sql=readFileSync(new URL('supabase/migrations/20261019003500_facebook_messenger_thread_previews.sql',root),'utf8');
const inbox=readFileSync(new URL('lib/messaging/facebook/messenger/inbox.js',root),'utf8');
const ui=readFileSync(new URL('components/CommercialInbox.js',root),'utf8');
test('Facebook recovery uses message sender display name even without participants',()=>{
 assert.match(importer,/m\.from\?\.name/);
 assert.match(importer,/conversationPsid=psid/);
 assert.match(importer,/p_kind:'profile'/);
});
test('fallback preview is encrypted at rest and gated by exact allowed thread',()=>{
 assert.match(sql,/facebook_messenger_private\.allowed\(p_connection,e\.thread_ref,p_actor,false\)/);
 assert.match(sql,/e\.content_box/);
 assert.doesNotMatch(sql,/insert into|update facebook_messenger_private|sender_enabled/i);
 assert.match(inbox,/open\(c,'content',binding\(e\),e\.content_box\)/);
 assert.match(ui,/t\.preview/);
});
