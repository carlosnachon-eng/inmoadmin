begin;
do $$ begin
  if exists(select 1 from public.shadow_media_interpretations) then raise exception 'Rollback refused: preserve media interpretation audit'; end if;
end $$;
drop table if exists public.shadow_media_interpretations;
commit;
