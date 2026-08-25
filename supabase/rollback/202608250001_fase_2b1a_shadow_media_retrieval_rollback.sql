begin;
do $$ begin
  if exists(select 1 from public.shadow_media_retrieval_queue) then raise exception 'Rollback refused: media retrieval audit exists'; end if;
end $$;
drop function if exists public.fail_shadow_media_retrieval(uuid,uuid,text,timestamptz,text);
drop function if exists public.complete_shadow_media_retrieval(uuid,uuid,jsonb);
drop function if exists public.claim_shadow_media_retrieval(uuid,timestamptz);
drop table if exists public.shadow_media_retrieval_queue;
commit;
