import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const sql=readFileSync(new URL('supabase/migrations/20261019113000_facebook_supervisor_reply_visibility.sql',root),'utf8');
const ui=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
test('supervisor visibility permits replies only to active supervisors',()=>{
 assert.match(sql,/p\.active=true/);
 assert.match(sql,/p\.role_id in \('admin','gerente_ventas'\)/);
 assert.match(sql,/x\.enabled/);
});
test('advisors still require exact active grant and can_reply',()=>{
 for(const fragment of ['g.connection_id=c','g.thread_ref=t','g.actor_id=a','g.expires_at>now()','not reply or g.can_reply'])assert.ok(sql.includes(fragment));
});
test('mobile form buttons are not forced into 38px circles',()=>{
 assert.match(ui,/\.composer button:not\(\.composeRow>button\)\{width:auto;height:auto\}/);
});
