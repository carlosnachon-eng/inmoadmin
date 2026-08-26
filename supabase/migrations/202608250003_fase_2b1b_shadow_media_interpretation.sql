-- Fase 2B.1B: resultados visuales Shadow sanitizados. Sin binarios, URLs, output bruto, outbound ni mutaciones ERP/Respond.
begin;

create table if not exists public.shadow_media_interpretations (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.shadow_media_retrieval_queue(id) on delete restrict,
  provider text not null check(provider='respond_admin'),
  external_message_id text not null check(length(external_message_id) between 1 and 200),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  runtime_version text not null check(runtime_version ~ '^shadow-media-vision-v[0-9]+$'),
  model text not null check(length(model) between 1 and 120),
  media_type text not null check(media_type='image'),
  status text not null check(status in ('processing','completed','failed')),
  result_safe jsonb not null default '{}'::jsonb check(
    jsonb_typeof(result_safe)='object'
    and result_safe-array['media_type','interpretation_status','category','summary','extracted_fields','confidence','requires_human_review','review_reason','runtime_version','model','interpreted_at']='{}'::jsonb
    and result_safe::text !~* '(https?://|base64|data:image|ciphertext|wrapped_key|nonce|auth_tag|raw_output|prompt|headers?|certificate|respond_io_token)'
  ),
  provider_request_id text check(provider_request_id is null or length(provider_request_id)<=120),
  input_tokens integer not null default 0 check(input_tokens>=0),
  output_tokens integer not null default 0 check(output_tokens>=0),
  estimated_cost_usd numeric(12,8) not null default 0 check(estimated_cost_usd>=0),
  latency_ms integer check(latency_ms is null or latency_ms>=0),
  error_code text check(error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  interpreted_at timestamptz,
  constraint shadow_media_interpretation_state_check check(
    (status='processing' and result_safe='{}'::jsonb and error_code is null and interpreted_at is null)
    or (status='completed' and result_safe->>'interpretation_status'='completed' and error_code is null and interpreted_at is not null)
    or (status='failed' and result_safe='{}'::jsonb and error_code is not null and interpreted_at is not null)
  )
);

create unique index if not exists shadow_media_interpretation_content_runtime_uidx
  on public.shadow_media_interpretations(content_hash,runtime_version);
create index if not exists shadow_media_interpretation_message_idx
  on public.shadow_media_interpretations(provider,external_message_id,status,interpreted_at desc);

alter table public.shadow_media_interpretations enable row level security;
revoke all on public.shadow_media_interpretations from public,anon,authenticated;
grant select,insert,update on public.shadow_media_interpretations to service_role;

commit;
