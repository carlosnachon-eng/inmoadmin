-- Fase 2B.1A: cola efímera cifrada para recuperación técnica de multimedia. Sin modelo, outbound ni backfill.
begin;

create table if not exists public.shadow_media_retrieval_queue (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider='respond_admin'),
  external_message_id text not null check(length(external_message_id) between 1 and 200),
  attachment_index smallint not null default 0 check(attachment_index between 0 and 4),
  channel_id text not null check(channel_id='544519'),
  channel_source text not null check(channel_source='whatsapp_business'),
  reference_key text not null unique check(length(reference_key) between 64 and 400),
  reference_hash text not null check(reference_hash ~ '^[0-9a-f]{64}$'),
  host_hash text not null check(host_hash ~ '^[0-9a-f]{64}$'),
  encrypted_reference text check(encrypted_reference is null or length(encrypted_reference)<=6000),
  wrapped_key text check(wrapped_key is null or length(wrapped_key)<=1000),
  nonce text check(nonce is null or length(nonce)<=64),
  auth_tag text check(auth_tag is null or length(auth_tag)<=64),
  declared_mime text,
  declared_size bigint check(declared_size is null or declared_size>=0),
  is_pending boolean not null default false,
  status text not null check(status in ('pending','processing','completed','expired','rejected','failed')),
  attempts smallint not null default 0 check(attempts between 0 and 4),
  next_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  locked_at timestamptz,
  locked_by uuid,
  result_safe jsonb not null default '{}'::jsonb check(jsonb_typeof(result_safe)='object' and result_safe-array['retrieval_status','mime','size','sha256','pages','attempts','latency_ms','completed_at']='{}'::jsonb and result_safe::text !~* '(https?://|base64|ciphertext|wrapped_key|nonce|auth_tag)'),
  error_code text check(error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint shadow_media_cipher_lifecycle_check check(
    (status in ('pending','processing') and encrypted_reference is not null and wrapped_key is not null and nonce is not null and auth_tag is not null)
    or (status in ('completed','expired','rejected','failed') and encrypted_reference is null and wrapped_key is null and nonce is null and auth_tag is null)
  ),
  constraint shadow_media_ttl_check check(expires_at>created_at and expires_at<=created_at+interval '30 minutes 5 seconds')
);
comment on table public.shadow_media_retrieval_queue is 'fase-2b1a: encrypted ephemeral locator; no raw URL, binary, payload or model output';
create unique index if not exists shadow_media_retrieval_identity_uidx on public.shadow_media_retrieval_queue(provider,external_message_id,attachment_index,reference_hash);
create index if not exists shadow_media_retrieval_claim_idx on public.shadow_media_retrieval_queue(status,next_attempt_at,expires_at,created_at) where status in ('pending','processing');

alter table public.shadow_media_retrieval_queue enable row level security;
revoke all on public.shadow_media_retrieval_queue from public,anon,authenticated;
grant all on public.shadow_media_retrieval_queue to service_role;

create or replace function public.claim_shadow_media_retrieval(p_worker_id uuid,p_now timestamptz default now())
returns public.shadow_media_retrieval_queue language plpgsql security definer set search_path=public as $$
declare claimed public.shadow_media_retrieval_queue;
begin
  update public.shadow_media_retrieval_queue set status='expired',encrypted_reference=null,wrapped_key=null,nonce=null,auth_tag=null,locked_at=null,locked_by=null,error_code='ttl_expired',completed_at=p_now
  where status in ('pending','processing') and expires_at<=p_now;
  with candidate as (
    select id from public.shadow_media_retrieval_queue
    where ((status='pending' and next_attempt_at<=p_now) or (status='processing' and locked_at<p_now-interval '2 minutes')) and expires_at>p_now and attempts<4
    order by next_attempt_at,created_at for update skip locked limit 1
  )
  update public.shadow_media_retrieval_queue q set status='processing',attempts=q.attempts+1,locked_at=p_now,locked_by=p_worker_id
  from candidate where q.id=candidate.id returning q.* into claimed;
  return claimed;
end $$;

create or replace function public.complete_shadow_media_retrieval(p_queue_id uuid,p_worker_id uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.shadow_media_retrieval_queue set status='completed',result_safe=p_result,encrypted_reference=null,wrapped_key=null,nonce=null,auth_tag=null,locked_at=null,locked_by=null,error_code=null,completed_at=now()
  where id=p_queue_id and status='processing' and locked_by=p_worker_id;
  return found;
end $$;

create or replace function public.fail_shadow_media_retrieval(p_queue_id uuid,p_worker_id uuid,p_error_code text,p_retry_at timestamptz,p_terminal_status text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_terminal_status not in ('pending','expired','rejected','failed') or p_error_code !~ '^[a-z0-9_]{1,80}$' then raise exception 'invalid_media_failure_state'; end if;
  update public.shadow_media_retrieval_queue set status=p_terminal_status,error_code=p_error_code,next_attempt_at=coalesce(p_retry_at,next_attempt_at),
    encrypted_reference=case when p_terminal_status='pending' then encrypted_reference end,
    wrapped_key=case when p_terminal_status='pending' then wrapped_key end,
    nonce=case when p_terminal_status='pending' then nonce end,
    auth_tag=case when p_terminal_status='pending' then auth_tag end,
    locked_at=null,locked_by=null,completed_at=case when p_terminal_status='pending' then null else now() end
  where id=p_queue_id and status='processing' and locked_by=p_worker_id and (p_terminal_status<>'pending' or (p_retry_at is not null and p_retry_at<expires_at));
  return found;
end $$;

revoke all on function public.claim_shadow_media_retrieval(uuid,timestamptz),public.complete_shadow_media_retrieval(uuid,uuid,jsonb),public.fail_shadow_media_retrieval(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.claim_shadow_media_retrieval(uuid,timestamptz),public.complete_shadow_media_retrieval(uuid,uuid,jsonb),public.fail_shadow_media_retrieval(uuid,uuid,text,timestamptz,text) to service_role;

commit;
