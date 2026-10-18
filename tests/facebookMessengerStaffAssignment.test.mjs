import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261018223000_facebook_messenger_staff_assignments.sql',import.meta.url),'utf8');
const api=readFileSync(new URL('../pages/api/operaciones/facebook-messenger-assign.js',import.meta.url),'utf8');
test('only manager/admin can assign verified sales advisors to real inbound threads',()=>{
 assert.match(sql,/role_id in \('admin','gerente_ventas'\)/);
 assert.match(sql,/role_id='asesor'/);
 assert.match(sql,/v_sales_team_directory/);
 assert.match(sql,/kind='inbound'/);
 assert.match(api,/\['admin','gerente_ventas'\]/);
});
test('one thread reassignment revokes previous advisor grant and adds only exact thread',()=>{
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/delete from facebook_messenger_private\.thread_grants/);
 assert.match(sql,/g\.actor_id<>p_advisor/);
 assert.match(sql,/insert into facebook_messenger_private\.thread_grants/);
 assert.match(sql,/interval '7 days'/);
});
test('sender not enabled by assignment and API requires verified session',()=>{
 assert.doesNotMatch(sql,/update facebook_messenger_private\.connections\s+set sender_enabled/);
 assert.match(api,/authorizeInboxStaff\(req\)/);
 assert.match(api,/messengerConfig\(process\.env\)/);
 assert.match(api,/fb_messenger_assign_thread_v1/);
});
