import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const sql=readFileSync(new URL('supabase/migrations/20261019011500_facebook_consecutive_manual_replies.sql',root),'utf8');
const js=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
const reader=readFileSync(new URL('lib/messaging/facebook/messenger/inbox.js',root),'utf8');
test('multiple replies reuse inbound window but not action IDs',()=>{
 assert.match(sql,/drop constraint if exists actions_connection_id_input_ref_key/);
 assert.match(sql,/on conflict\(action_id\) do nothing/);
 assert.match(sql,/send_allowed\(/);
});
test('claimed, dispatching, or uncertain sends block another reply to thread',()=>{
 assert.match(sql,/a\.state in \('claimed','dispatching','uncertain'\)/);
 assert.match(sql,/x\.state in \('claimed','dispatching','uncertain'\)/);
 assert.doesNotMatch(sql,/update facebook_messenger_private\.connections\s+set sender_enabled/i);
});
test('UI unlocks only after accepted; messages always manually dispatched',()=>{
 assert.match(js,/if\(result\.status==='accepted'\)locked\.current=false/);
 assert.match(js,/onSubmit=\{send\}/);
 assert.match(reader,/can_reply:e\.reply_allowed===true&&!e\.deleted&&e\.kind==='inbound'/);
});
