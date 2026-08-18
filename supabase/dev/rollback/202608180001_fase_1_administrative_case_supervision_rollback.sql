begin;
drop function if exists public.supervise_administrative_case(text,text,jsonb,text);
drop table if exists public.administrative_case_actions;
drop table if exists public.administrative_case_controls;
commit;
