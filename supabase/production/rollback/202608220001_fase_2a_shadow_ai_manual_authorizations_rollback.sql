-- Conservative rollback: refuse if audit rows exist.
begin;
do $$ begin
  if to_regclass('public.shadow_ai_manual_authorizations') is not null
     and exists(select 1 from public.shadow_ai_manual_authorizations) then
    raise exception 'Rollback refused: manual authorization audit rows exist';
  end if;
end $$;
drop function if exists public.consume_shadow_ai_manual_authorization(uuid,uuid,uuid,text,text);
drop function if exists public.authorize_shadow_ai_manual_message(uuid,uuid,text,text,integer);
drop function if exists public.revoke_shadow_ai_manual_authorization(uuid);
drop table if exists public.shadow_ai_manual_authorizations;
commit;
