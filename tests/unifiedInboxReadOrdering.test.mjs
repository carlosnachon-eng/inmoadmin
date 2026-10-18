import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const ui=readFileSync(new URL('components/CommercialInbox.js',root),'utf8');
const names=readFileSync(new URL('pages/api/operaciones/facebook-messenger-names.js',root),'utf8');
const sql=readFileSync(new URL('supabase/migrations/20261019005000_facebook_messenger_read_state.sql',root),'utf8');
test('unified inbox sorts by normalized timestamps across Instagram and Facebook',()=>{
 assert.match(ui,/Date\.parse\(date\|\|''\)/);assert.match(ui,/timestamp\(b\)-timestamp\(a\)/);
});
test('read flags are scoped and no Meta read receipts are sent',()=>{
 assert.match(sql,/thread_read_state/);assert.match(sql,/actor_id=p_actor/);
 assert.match(sql,/facebook_messenger_private\.allowed/);
 assert.doesNotMatch(sql,/sender_enabled\s*=|insert into facebook_messenger_private\.actions/);
 assert.match(ui,/notification-read/);assert.match(ui,/facebook-messenger-read-state/);
});
test('Facebook alias accepts real names including x and digits',()=>{
 assert.doesNotMatch(names,/\[<>\\\\x00-/);
 assert.match(names,/\[<>\\u0000-/);
});
