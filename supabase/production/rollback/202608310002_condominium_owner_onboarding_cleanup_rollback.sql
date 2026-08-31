begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
begin
  if to_regclass('public.condominium_owner_onboarding_cleanup_audit') is not null
     and exists(select 1 from public.condominium_owner_onboarding_cleanup_audit) then
    raise exception 'Rollback bloqueado: existe auditoría de cleanup que debe preservarse.';
  end if;
end $$;

drop function if exists public.cleanup_condominium_owner_onboarding_profile(uuid,uuid,uuid,text);
drop table if exists public.condominium_owner_onboarding_cleanup_audit;
commit;
