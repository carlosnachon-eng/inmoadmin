import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Explicit opt-in. Requires the synthetic accounts created for PR #131 QA.
assert.equal(process.env.BLINDAJE_DEV_PROJECT_REF, 'hjfwjnejbcpmknvfpdcq')
const accounts = JSON.parse(readFileSync(process.env.BLINDAJE_QA_ACCOUNTS_FILE, 'utf8'))
const candidate = readFileSync(new URL('../supabase/security/blindaje_read_access_candidate.sql', import.meta.url), 'utf8')
const id = 'c01c0000-0000-4000-8000-000000000011'
for (const value of Object.values(accounts)) {
  assert.match(value.id, /^[0-9a-f-]{36}$/)
  assert.ok(value.email.startsWith('qa.blindaje.security.'))
}
const context = name => `select set_config('request.jwt.claims','${JSON.stringify({sub:accounts[name].id,role:'authenticated'})}',true); set local role authenticated;`
const visibility = (name, expected) => `${context(name)}
do $$ begin
 if (select count(*) from public.solicitudes_inquilino where id='${id}') <> ${expected}
 then raise exception 'Unexpected visibility for ${name}'; end if;
end $$; reset role;`
const query = `begin;
${candidate}
${visibility('juridico',1)} ${visibility('admin',1)}
${visibility('inactive',0)} ${visibility('no_profile',0)}
${visibility('no_permission',0)} ${visibility('propio',0)} ${visibility('partner_a',0)}
${context('partner_a')}
do $$ begin
 if exists(select 1 from public.solicitudes_inquilino where id='c01c0000-0000-4000-8000-000000000012') then raise exception 'Cross agency request exposed'; end if;
 if not exists(select 1 from public.partner_operations where id='c01d0000-0000-4000-8000-000000000011') then raise exception 'Own operation missing'; end if;
 if exists(select 1 from public.partner_operations where id='c01d0000-0000-4000-8000-000000000012') then raise exception 'Cross agency operation exposed'; end if;
 if exists(select 1 from public.partner_participants where id='c01f0000-0000-4000-8000-000000000011') then raise exception 'Private participants policy bypassed'; end if;
end $$; reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
do $$ declare new_id uuid; blocked boolean := false; begin
 if exists(select 1 from public.solicitudes_inquilino where id='${id}') then raise exception 'Anonymous request exposed'; end if;
 begin
 insert into public.solicitudes_inquilino(nombre_completo) values('QA Public Regression - rolled back') returning id into new_id;
 exception when insufficient_privilege then blocked := true;
 end;
 if not blocked then raise exception 'Known public RETURNING regression not reproduced'; end if;
end $$; reset role;
rollback;
select jsonb_build_object('candidate_assertions_passed',true,
 'public_flow_certification','NO-GO: INSERT RETURNING and complement read require authorized transport',
 'dev_rls_restored',not relrowsecurity) as result
from pg_class where oid='public.solicitudes_inquilino'::regclass;`
const output = execFileSync(process.env.SUPABASE_CLI || 'supabase', ['db','query','--linked','--project-ref',process.env.BLINDAJE_DEV_PROJECT_REF,query,'-o','json'], {encoding:'utf8'})
console.log(output)
