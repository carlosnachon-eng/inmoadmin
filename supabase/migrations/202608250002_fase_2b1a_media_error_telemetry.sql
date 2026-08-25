-- Fase 2B.1A: código y etapa sanitizados para fallos técnicos. Sin URL, mensaje de error ni payload.
begin;

alter table public.shadow_media_retrieval_queue
  add column if not exists error_stage text
  check(error_stage is null or error_stage in (
    'dns_resolution','ssrf_validation','tcp_connect','tls_handshake','http_request',
    'redirect_validation','stream_read','content_validation'
  ));

create or replace function public.complete_shadow_media_retrieval(p_queue_id uuid,p_worker_id uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.shadow_media_retrieval_queue set status='completed',result_safe=p_result,encrypted_reference=null,wrapped_key=null,nonce=null,auth_tag=null,locked_at=null,locked_by=null,error_code=null,error_stage=null,completed_at=now()
  where id=p_queue_id and status='processing' and locked_by=p_worker_id;
  return found;
end $$;

create or replace function public.fail_shadow_media_retrieval(
  p_queue_id uuid,p_worker_id uuid,p_error_code text,p_error_stage text,
  p_retry_at timestamptz,p_terminal_status text
)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_terminal_status not in ('pending','expired','rejected','failed')
     or p_error_code !~ '^[a-z0-9_]{1,80}$'
     or (p_error_stage is not null and p_error_stage not in (
       'dns_resolution','ssrf_validation','tcp_connect','tls_handshake','http_request',
       'redirect_validation','stream_read','content_validation'
     )) then raise exception 'invalid_media_failure_state'; end if;
  update public.shadow_media_retrieval_queue set status=p_terminal_status,error_code=p_error_code,error_stage=p_error_stage,next_attempt_at=coalesce(p_retry_at,next_attempt_at),
    encrypted_reference=case when p_terminal_status='pending' then encrypted_reference end,
    wrapped_key=case when p_terminal_status='pending' then wrapped_key end,
    nonce=case when p_terminal_status='pending' then nonce end,
    auth_tag=case when p_terminal_status='pending' then auth_tag end,
    locked_at=null,locked_by=null,completed_at=case when p_terminal_status='pending' then null else now() end
  where id=p_queue_id and status='processing' and locked_by=p_worker_id and (p_terminal_status<>'pending' or (p_retry_at is not null and p_retry_at<expires_at));
  return found;
end $$;

revoke all on function public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.fail_shadow_media_retrieval(uuid,uuid,text,text,timestamptz,text) to service_role;

commit;
