begin;

-- Observation only. No journal mutation, consumer, trigger on source tables,
-- provider activation, contact bridge, business queue or global default change.
create table public.messaging_correlation_assessments (
  id uuid primary key default gen_random_uuid(),
  meta_event_id uuid not null references public.meta_observer_events(id),
  version integer not null check (version > 0),
  rules_version text not null check (rules_version = 'admin-native-v1'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  read_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  waba_id text not null,
  phone_number_id text not null,
  respond_channel_id text not null check (respond_channel_id = '544519'),
  state text not null check (state in ('matched','unmatched','ambiguous')),
  reason text not null check (reason in ('exact_native_id','no_candidates','temporal_only',
    'semantic_conflict','identity_conflict','candidate_limit')),
  candidate_count integer not null check (candidate_count between 0 and 201),
  candidates_truncated boolean not null default false,
  -- Original of revoke/edit, or same-message base observation for statuses.
  -- A late original produces a NEW assessment, never an UPDATE.
  related_meta_event_id uuid references public.meta_observer_events(id),
  related_meta_count integer not null check (related_meta_count >= 0),
  observer_only boolean not null default true check (observer_only),
  business_dedupe_allowed boolean not null default false check (not business_dedupe_allowed),
  human_authorship_proven boolean not null default false check (not human_authorship_proven),
  unique (meta_event_id, version),
  check ((state = 'unmatched' and reason = 'no_candidates' and candidate_count = 0)
    or (state = 'matched' and reason = 'exact_native_id' and candidate_count > 0 and not candidates_truncated)
    or (state = 'ambiguous' and reason not in ('no_candidates','exact_native_id') and candidate_count > 0)),
  check ((related_meta_count = 1) = (related_meta_event_id is not null))
);
create index messaging_correlation_assessments_scope_idx
  on public.messaging_correlation_assessments(waba_id,phone_number_id,created_at,id);
create index messaging_correlation_assessments_related_idx
  on public.messaging_correlation_assessments(related_meta_event_id) where related_meta_event_id is not null;

create table public.messaging_correlation_candidates (
  assessment_id uuid not null references public.messaging_correlation_assessments(id),
  respond_event_id text not null references public.gv_respond_webhook_events(event_id),
  respond_message_id text,
  respond_event_type text not null check (respond_event_type in ('message.received','message.sent')),
  respond_contact_ref text not null check (respond_contact_ref ~ '^[a-f0-9]{64}$'),
  respond_occurred_at timestamptz,
  respond_received_at timestamptz not null,
  traffic text check (traffic in ('incoming','outgoing','unknown')),
  delta_ms numeric,
  exact_native_id boolean not null,
  semantic_compatible boolean not null,
  primary key (assessment_id,respond_event_id)
);
create index messaging_correlation_candidates_event_idx
  on public.messaging_correlation_candidates(respond_event_id);

create table public.messaging_message_equivalences (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null,
  phone_number_id text not null,
  respond_channel_id text not null check (respond_channel_id = '544519'),
  native_message_id text not null check (length(native_message_id) between 7 and 506
    and native_message_id ~ '^wamid\.[A-Za-z0-9+/=_-]+$'),
  respond_message_id text not null,
  proof_kind text not null check (proof_kind = 'journal_native_id_equality'),
  meta_event_id uuid not null references public.meta_observer_events(id),
  respond_event_id text not null references public.gv_respond_webhook_events(event_id),
  assessment_id uuid not null references public.messaging_correlation_assessments(id),
  created_at timestamptz not null default clock_timestamp(),
  observer_only boolean not null default true check (observer_only),
  business_dedupe_allowed boolean not null default false check (not business_dedupe_allowed),
  check (respond_message_id = native_message_id),
  unique (waba_id,phone_number_id,native_message_id),
  unique (respond_channel_id,respond_message_id),
  foreign key (assessment_id,respond_event_id)
    references public.messaging_correlation_candidates(assessment_id,respond_event_id)
);
create index messaging_message_equivalences_meta_idx on public.messaging_message_equivalences(meta_event_id);
create index messaging_message_equivalences_respond_idx on public.messaging_message_equivalences(respond_event_id);

-- Respond currently journals only received/sent, not typed edits/revokes or
-- delivery/read/failure observations. Never fabricate those missing semantics.
create function public.messaging_correlation_semantics_v1(
  p_category text,p_message_type text,p_meta_type text,p_respond_type text,p_traffic text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(p_message_type not in ('edit','revoke') and p_meta_type = p_respond_type and
    ((p_category = 'inbound' and p_meta_type = 'message.received' and p_traffic = 'incoming')
     or (p_category = 'app_echo' and p_meta_type = 'message.sent' and p_traffic = 'outgoing')),false);
$$;

-- Defense in depth: even a direct service-role INSERT cannot manufacture an
-- equivalence using a caller-supplied wamid, timestamp, phone or heuristic flag.
create function public.messaging_equivalence_proof_guard_v1() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.meta_observer_events m
    join public.meta_observer_admin_scope s on s.waba_id=m.waba_id and s.phone_number_id=m.phone_number_id
    join public.gv_respond_webhook_events r on r.event_id=new.respond_event_id
    join public.messaging_correlation_assessments a on a.id=new.assessment_id
    join public.messaging_correlation_candidates c on c.assessment_id=a.id and c.respond_event_id=r.event_id
    where m.id=new.meta_event_id and m.observer_only and m.state='observed'
      and s.respond_channel_id=new.respond_channel_id
      and r.payload_meta->>'channel_id'=s.respond_channel_id
      and m.waba_id=new.waba_id and m.phone_number_id=new.phone_number_id
      and m.native_message_id=new.native_message_id and r.message_id=new.native_message_id
      and a.meta_event_id=m.id and a.state='matched' and a.reason='exact_native_id'
      and a.waba_id=m.waba_id and a.phone_number_id=m.phone_number_id
      and c.exact_native_id and c.semantic_compatible
      and c.respond_message_id=r.message_id
      and public.messaging_correlation_semantics_v1(m.category,m.message_type,m.event_type,r.event_type,r.payload_meta->>'traffic')
      and not exists (select 1 from public.gv_respond_webhook_events other
        where other.message_id=m.native_message_id and other.payload_meta->>'channel_id'=s.respond_channel_id
          and other.event_type in ('message.received','message.sent')
          and (other.respond_contact_id<>r.respond_contact_id or not public.messaging_correlation_semantics_v1(
            m.category,m.message_type,m.event_type,other.event_type,other.payload_meta->>'traffic')))
  ) then
    raise exception 'messaging_exact_identity_unproven' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger messaging_equivalence_proof_guard before insert on public.messaging_message_equivalences
  for each row execute function public.messaging_equivalence_proof_guard_v1();

-- One explicit observation ID per call. No caller-provided candidates, match
-- verdicts or certified mappings. All evidence is read from durable journals.
create function public.assess_messaging_admin_correlation_v1(p_meta_event_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  m public.meta_observer_events%rowtype;
  previous public.messaging_correlation_assessments%rowtype;
  candidate_json jsonb;
  related_ids uuid[];
  related_id uuid;
  related_count integer;
  fingerprint text;
  assessment_id uuid;
  assessment_version integer;
  candidate_count integer;
  exact_count integer;
  exact_compatible integer;
  exact_contacts integer;
  has_conflict boolean;
  state text;
  reason text;
  proof_event text;
  observation_time timestamptz;
begin
  select * into strict m from public.meta_observer_events where id=p_meta_event_id;
  if not m.observer_only or m.state<>'observed' or not exists (
    select 1 from public.meta_observer_admin_scope s where s.waba_id=m.waba_id
      and s.phone_number_id=m.phone_number_id and s.respond_channel_id='544519'
  ) then raise exception 'messaging_admin_scope_denied' using errcode='42501'; end if;

  -- Serializes ONLY correlation evaluators in this Admin scope; source ingestion
  -- and all commercial consumers do not acquire this lock and are untouched.
  perform pg_advisory_xact_lock(hashtextextended('messaging-correlation:'||m.waba_id||':'||m.phone_number_id,0));
  observation_time := clock_timestamp();
  -- One MVCC statement captures candidates + original linkage. Evidence hash
  -- includes the actual rows, not just a wall-clock cutoff (late commits count).
  with candidates as (
    select r.event_id as respond_event_id,r.message_id as respond_message_id,
      r.event_type as respond_event_type,
      encode(sha256(convert_to(r.respond_contact_id,'UTF8')),'hex') as respond_contact_ref,
      r.event_occurred_at as respond_occurred_at,r.received_at as respond_received_at,
      case when r.payload_meta->>'traffic' in ('incoming','outgoing') then r.payload_meta->>'traffic' else 'unknown' end as traffic,
      extract(epoch from (r.event_occurred_at-m.occurred_at))*1000 as delta_ms,
      coalesce(r.message_id=m.native_message_id,false) as exact_native_id,
      public.messaging_correlation_semantics_v1(m.category,m.message_type,m.event_type,r.event_type,r.payload_meta->>'traffic') as semantic_compatible
    from public.gv_respond_webhook_events r
    where r.payload_meta->>'channel_id'='544519' and r.event_type in ('message.received','message.sent')
      and (r.message_id=m.native_message_id or r.event_occurred_at between m.occurred_at-interval '2 seconds' and m.occurred_at+interval '2 seconds')
    order by (r.message_id=m.native_message_id) desc nulls last,r.event_id
    limit 201
  ), related as (
    select b.id from public.meta_observer_events b
    where b.waba_id=m.waba_id and b.phone_number_id=m.phone_number_id and b.id<>m.id
      and b.category in ('inbound','app_echo') and b.message_type not in ('edit','revoke')
      and b.native_message_id=case when m.original_message_id is not null then m.original_message_id
        when m.category='status' then m.native_message_id else null end
    order by b.id
  )
  select coalesce((select jsonb_agg(to_jsonb(c) order by c.respond_event_id) from candidates c),'[]'::jsonb),
    array(select id from related) into candidate_json,related_ids;
  related_count := cardinality(related_ids);
  related_id := case when related_count=1 then related_ids[1] else null end;
  candidate_count := jsonb_array_length(candidate_json);
  select count(*) filter (where (c->>'exact_native_id')::boolean),
    count(*) filter (where (c->>'exact_native_id')::boolean and (c->>'semantic_compatible')::boolean),
    count(distinct c->>'respond_contact_ref') filter (where (c->>'exact_native_id')::boolean),
    min(c->>'respond_event_id') filter (where (c->>'exact_native_id')::boolean and (c->>'semantic_compatible')::boolean)
    into exact_count,exact_compatible,exact_contacts,proof_event from jsonb_array_elements(candidate_json) c;
  select exists(select 1 from public.messaging_message_equivalences e
    where e.respond_channel_id='544519' and e.respond_message_id=m.native_message_id
      and (e.waba_id<>m.waba_id or e.phone_number_id<>m.phone_number_id)) into has_conflict;
  if candidate_count>200 then state:='ambiguous'; reason:='candidate_limit';
  elsif candidate_count=0 then state:='unmatched'; reason:='no_candidates';
  elsif has_conflict or exact_contacts>1 then state:='ambiguous'; reason:='identity_conflict';
  elsif exact_count>0 and exact_compatible=exact_count then state:='matched'; reason:='exact_native_id';
  elsif exact_count>0 or not exists(select 1 from jsonb_array_elements(candidate_json) c where (c->>'semantic_compatible')::boolean)
    then state:='ambiguous'; reason:='semantic_conflict';
  else state:='ambiguous'; reason:='temporal_only'; end if;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('rules','admin-native-v1',
    'meta',to_jsonb(m),'candidates',candidate_json,'related',to_jsonb(related_ids),'conflict',has_conflict)::text,'UTF8')),'hex');
  select * into previous from public.messaging_correlation_assessments a
    where a.meta_event_id=m.id order by a.version desc limit 1;
  if previous.evidence_sha256=fingerprint then
    return jsonb_build_object('assessment_id',previous.id,'version',previous.version,'state',previous.state,
      'reason',previous.reason,'candidate_count',previous.candidate_count,'reused',true,
      'observer_only',true,'business_dedupe_allowed',false,'human_authorship_proven',false);
  end if;
  assessment_id:=gen_random_uuid(); assessment_version:=coalesce(previous.version,0)+1;
  insert into public.messaging_correlation_assessments(id,meta_event_id,version,rules_version,evidence_sha256,
    read_at,waba_id,phone_number_id,respond_channel_id,state,reason,candidate_count,candidates_truncated,
    related_meta_event_id,related_meta_count)
  values(assessment_id,m.id,assessment_version,'admin-native-v1',fingerprint,observation_time,m.waba_id,m.phone_number_id,
    '544519',state,reason,candidate_count,candidate_count>200,related_id,related_count);
  insert into public.messaging_correlation_candidates(assessment_id,respond_event_id,respond_message_id,
    respond_event_type,respond_contact_ref,respond_occurred_at,respond_received_at,traffic,delta_ms,exact_native_id,semantic_compatible)
  select assessment_id,c.respond_event_id,c.respond_message_id,c.respond_event_type,c.respond_contact_ref,
    c.respond_occurred_at,c.respond_received_at,c.traffic,c.delta_ms,c.exact_native_id,c.semantic_compatible
    from jsonb_to_recordset(candidate_json) as c(respond_event_id text,respond_message_id text,respond_event_type text,
      respond_contact_ref text,respond_occurred_at timestamptz,respond_received_at timestamptz,
      traffic text,delta_ms numeric,exact_native_id boolean,semantic_compatible boolean);
  if state='matched' then
    insert into public.messaging_message_equivalences(waba_id,phone_number_id,respond_channel_id,native_message_id,
      respond_message_id,proof_kind,meta_event_id,respond_event_id,assessment_id)
    values(m.waba_id,m.phone_number_id,'544519',m.native_message_id,m.native_message_id,
      'journal_native_id_equality',m.id,proof_event,assessment_id)
    on conflict (waba_id,phone_number_id,native_message_id) do nothing;
  end if;
  return jsonb_build_object('assessment_id',assessment_id,'version',assessment_version,'state',state,'reason',reason,
    'candidate_count',candidate_count,'reused',false,'observer_only',true,'business_dedupe_allowed',false,'human_authorship_proven',false);
end;
$$;

alter table public.messaging_correlation_assessments enable row level security;
alter table public.messaging_correlation_candidates enable row level security;
alter table public.messaging_message_equivalences enable row level security;
revoke all on table public.messaging_correlation_assessments,public.messaging_correlation_candidates,
  public.messaging_message_equivalences from public,anon,authenticated,service_role;
grant select,insert on table public.messaging_correlation_assessments,public.messaging_correlation_candidates,
  public.messaging_message_equivalences to service_role;
create policy messaging_assessments_service_read on public.messaging_correlation_assessments for select to service_role using(true);
create policy messaging_assessments_service_insert on public.messaging_correlation_assessments for insert to service_role with check(true);
create policy messaging_candidates_service_read on public.messaging_correlation_candidates for select to service_role using(true);
create policy messaging_candidates_service_insert on public.messaging_correlation_candidates for insert to service_role with check(true);
create policy messaging_equivalences_service_read on public.messaging_message_equivalences for select to service_role using(true);
create policy messaging_equivalences_service_insert on public.messaging_message_equivalences for insert to service_role with check(true);
revoke all on function public.assess_messaging_admin_correlation_v1(uuid),
  public.messaging_correlation_semantics_v1(text,text,text,text,text),public.messaging_equivalence_proof_guard_v1()
  from public,anon,authenticated,service_role;
grant execute on function public.assess_messaging_admin_correlation_v1(uuid),
  public.messaging_correlation_semantics_v1(text,text,text,text,text),public.messaging_equivalence_proof_guard_v1() to service_role;

comment on table public.messaging_correlation_assessments is 'Append-only Admin observer assessments. Not processing authority. Retain all versions on rollback.';
comment on table public.messaging_message_equivalences is 'Exact journal ID evidence only, not a contact bridge or permission to consume/send. No heuristic aliases.';
commit;
