begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Object-local repair for databases that applied the first #168 migration.
-- Idempotent after the corrected initial migration. Preserve data, definitions,
-- ownership, RLS, and project default privileges. Only the return RPC writes.
revoke all on public.respond_ai_resumptions from public, anon, authenticated, service_role;
grant select on public.respond_ai_resumptions to service_role;

revoke all on function public.read_respond_human_pause_v1(text,timestamptz),
 public.pause_sales_on_respond_human_v1(), public.begin_sales_human_guarded_send_v1(uuid),
 public.resume_respond_ai_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.read_respond_human_pause_v1(text,timestamptz),
 public.pause_sales_on_respond_human_v1(), public.begin_sales_human_guarded_send_v1(uuid) to service_role;
grant execute on function public.resume_respond_ai_v1(text,text,text) to authenticated;
commit;
