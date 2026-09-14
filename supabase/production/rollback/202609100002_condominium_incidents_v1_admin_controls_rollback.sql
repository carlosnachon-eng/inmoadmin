begin;
drop function if exists public.condominium_admin_update_incident_v1(uuid,uuid,text,text,uuid,boolean,text,text,text);
grant execute on function public.condominium_update_incident_v1(uuid,uuid,text,text,uuid,text,text,text) to authenticated;
commit;
