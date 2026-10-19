import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const api=readFileSync(new URL('pages/api/operaciones/facebook-messenger-advisors.js',root),'utf8');
const sql=readFileSync(new URL('supabase/migrations/20261019120000_facebook_assignment_role_parity.sql',root),'utf8');
test('Facebook assignee directory includes leadership just like Instagram',()=>{
 assert.match(api,/\.in\('role_id',\['admin','gerente_ventas'\]\)/);
 assert.match(api,/v_sales_team_directory/);
 assert.match(api,/\.eq\('active',true\)/);
});
test('server permits leadership assignment and still scopes ordinary advisors',()=>{
 assert.match(sql,/p\.role_id in \('admin','gerente_ventas'\)/);
 assert.match(sql,/p\.role_id='asesor'/);
 assert.match(sql,/left_at is null/);
 assert.match(sql,/thread_ref=p_thread and kind='inbound'/);
 assert.match(sql,/thread_grants/);
});
test('no changes to Instagram assignment implementation',()=>{
 assert.doesNotMatch(api,/ig_business_thread_assignment_v1/);
});
