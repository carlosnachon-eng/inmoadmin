begin;
drop function if exists public.execute_administrative_work_r1(text,jsonb,text,text,uuid);
drop table if exists public.administrative_work_approvals;
drop table if exists public.administrative_work_history;
drop table if exists public.administrative_work_evidence;
drop table if exists public.administrative_work_source_links;
drop table if exists public.administrative_work_items;
commit;
