begin;
drop function if exists public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer);
grant execute on function public.execute_administrative_work_r1(text,jsonb,text,text,uuid) to service_role;
commit;
