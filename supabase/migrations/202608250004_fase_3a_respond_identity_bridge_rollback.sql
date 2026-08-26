-- Rollback conservador: se niega si existe cualquier vínculo/auditoría.
do $$ begin
  if to_regclass('public.respond_identity_links') is null then return; end if;
  if exists(select 1 from public.respond_identity_links limit 1)
     or exists(select 1 from public.respond_identity_audit limit 1) then
    raise exception 'Rollback bloqueado: Identity Bridge contiene auditoría';
  end if;
end $$;
begin;
drop function if exists public.find_respond_identity_candidates(text);
drop function if exists public.identity_phone_digest(text);
drop table if exists public.respond_identity_audit;
drop table if exists public.respond_identity_links;
drop index if exists public.shadow_conversations_respond_contact_idx;
alter table public.shadow_conversations drop constraint if exists shadow_conversations_respond_contact_scope_check;
alter table public.shadow_conversations drop column if exists respond_contact_id;
commit;
