begin;
drop function if exists public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text);
create or replace function public.complete_shadow_media_retrieval(p_queue_id uuid,p_worker_id uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.shadow_media_retrieval_queue set status='completed',result_safe=p_result,encrypted_reference=null,wrapped_key=null,nonce=null,auth_tag=null,locked_at=null,locked_by=null,error_code=null,completed_at=now()
  where id=p_queue_id and status='processing' and locked_by=p_worker_id;
  return found;
end $$;
alter table public.shadow_media_retrieval_queue drop column if exists error_stage;
commit;
