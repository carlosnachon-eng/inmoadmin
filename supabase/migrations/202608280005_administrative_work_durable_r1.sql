begin;

create table public.administrative_work_items (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain in ('maintenance','payment','administrative_pending','condominium_collection','service','policy_signature','recurring_task')),
  work_type text not null check (length(btrim(work_type)) between 3 and 80 and work_type ~ '^[a-z0-9_]+$'),
  title text not null check (length(btrim(title)) between 3 and 180),
  status text not null default 'open' check (status in ('open','in_progress','waiting_information','waiting_third_party','pending_approval','resolved','cancelled')),
  priority text not null default 'P2' check (priority in ('P0','P1','P2')),
  client_identity_id uuid null references public.client_identities(id) on delete restrict,
  contract_id uuid null references public.contracts(id) on delete restrict,
  property_id uuid null references public.properties(id) on delete restrict,
  condominium_id uuid null references public.condominios(id) on delete restrict,
  unit_id uuid null references public.unidades_condominio(id) on delete restrict,
  responsible_area text not null default 'Administración' check (length(btrim(responsible_area)) between 2 and 80),
  responsible_profile_id uuid null references public.profiles(id) on delete restrict,
  primary_source_type text not null check (primary_source_type in ('whatsapp','portal','payment','maintenance','service','condominium_fee','policy_signature','recurring_task','internal_event','derived_rule')),
  primary_source_id text not null check (length(btrim(primary_source_id)) between 1 and 160),
  source_context_key text null check (source_context_key is null or length(btrim(source_context_key)) between 8 and 500),
  dedupe_key text not null unique check (length(btrim(dedupe_key)) between 12 and 240 and dedupe_key !~ '[[:space:]]'),
  next_step text null check (next_step is null or length(next_step) <= 500),
  follow_up_at timestamptz null,
  information_received_at timestamptz null,
  requires_authorization boolean not null default false,
  automation_mode text not null default 'manual' check (automation_mode in ('manual','supervised','automatic')),
  duplicate_of_id uuid null references public.administrative_work_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint administrative_work_resolution_check check ((status='resolved')=(resolved_at is not null)),
  constraint administrative_work_duplicate_check check (duplicate_of_id is null or duplicate_of_id<>id)
);

create index administrative_work_lookup_idx on public.administrative_work_items(client_identity_id,contract_id,property_id,status);
create index administrative_work_domain_status_idx on public.administrative_work_items(domain,status,follow_up_at);
create index administrative_work_condominium_idx on public.administrative_work_items(condominium_id,unit_id,status);
create index administrative_work_context_idx on public.administrative_work_items(source_context_key) where source_context_key is not null;

create table public.administrative_work_source_links (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.administrative_work_items(id) on delete restrict,
  source_type text not null check (source_type in ('whatsapp_message','whatsapp_turn','portal_event','payment','maintenance_ticket','maintenance_quote','service_payment','condominium_fee','policy','signature','recurring_task','internal_event','derived_rule')),
  source_id text not null check (length(btrim(source_id)) between 1 and 160),
  source_event_key text null check (source_event_key is null or length(btrim(source_event_key)) between 8 and 240),
  link_key text not null unique check (length(btrim(link_key)) between 12 and 300 and link_key !~ '[[:space:]]'),
  created_at timestamptz not null default now()
);
create index administrative_work_source_lookup_idx on public.administrative_work_source_links(source_type,source_id);
create index administrative_work_source_item_idx on public.administrative_work_source_links(work_item_id,created_at);

create table public.administrative_work_evidence (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.administrative_work_items(id) on delete restrict,
  evidence_type text not null check (evidence_type in ('payment_receipt','image','document','media_interpretation','event','message','turn')),
  reference_type text not null check (reference_type in ('shadow_message','shadow_turn','media_interpretation','portal_record','operational_event','erp_record')),
  reference_id text not null check (length(btrim(reference_id)) between 1 and 160),
  evidence_key text not null unique check (length(btrim(evidence_key)) between 12 and 300 and evidence_key !~ '[[:space:]]'),
  summary_safe text null check (summary_safe is null or length(summary_safe) <= 500),
  received_at timestamptz null,
  created_at timestamptz not null default now()
);
create index administrative_work_evidence_item_idx on public.administrative_work_evidence(work_item_id,created_at);

create table public.administrative_work_history (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.administrative_work_items(id) on delete restrict,
  actor_type text not null check (actor_type in ('human','ai','system')),
  actor_profile_id uuid null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in ('created','source_linked','evidence_linked','note_added','information_received','next_step_set','follow_up_scheduled','possible_duplicate','responsible_assigned','approval_requested','status_changed')),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text null check (reason is null or length(reason) <= 500),
  capability text not null check (length(btrim(capability)) between 3 and 100),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 12 and 300 and idempotency_key !~ '[[:space:]]'),
  created_at timestamptz not null default now(),
  constraint administrative_work_history_actor_check check ((actor_type='human' and actor_profile_id is not null) or (actor_type in ('ai','system') and actor_profile_id is null))
);
create index administrative_work_history_item_idx on public.administrative_work_history(work_item_id,created_at);

create table public.administrative_work_approvals (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.administrative_work_items(id) on delete restrict,
  requested_capability text not null check (length(btrim(requested_capability)) between 3 and 100),
  risk_tier text not null check (risk_tier in ('R2','R3')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','consumed')),
  requested_by_type text not null check (requested_by_type in ('human','ai','system')),
  requested_by_profile_id uuid null references public.profiles(id) on delete restrict,
  reviewed_by_profile_id uuid null references public.profiles(id) on delete restrict,
  reason_safe text not null check (length(btrim(reason_safe)) between 3 and 500),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  expires_at timestamptz null,
  consumed_at timestamptz null,
  constraint administrative_work_approval_actor_check check ((requested_by_type='human' and requested_by_profile_id is not null) or requested_by_type in ('ai','system'))
);
create index administrative_work_approval_pending_idx on public.administrative_work_approvals(status,created_at) where status='pending';

create or replace function public.execute_administrative_work_r1(
  p_action text,
  p_input jsonb,
  p_idempotency_key text,
  p_actor_type text default 'ai',
  p_actor_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_item public.administrative_work_items;
  v_existing public.administrative_work_history;
  v_work_id uuid;
  v_before jsonb;
  v_forbidden boolean;
  v_action_type text;
begin
  if p_action not in ('create_administrative_pending','append_structured_internal_note','link_received_evidence','mark_information_received','set_nonfinancial_next_step','schedule_nonfinancial_follow_up','mark_possible_duplicate','assign_operational_responsible') then
    raise exception 'r1_action_not_allowlisted' using errcode='42501';
  end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalid_r1_input' using errcode='22023'; end if;
  if length(btrim(coalesce(p_idempotency_key,''))) not between 12 and 300 or p_idempotency_key ~ '[[:space:]]' then raise exception 'invalid_idempotency_key' using errcode='22023'; end if;
  if p_actor_type not in ('human','ai','system') or (p_actor_type='human' and p_actor_profile_id is null) or (p_actor_type in ('ai','system') and p_actor_profile_id is not null) then raise exception 'invalid_actor' using errcode='22023'; end if;
  v_forbidden := lower(p_input::text) ~ '(payment_confirmed|pago confirmado|conciliaci[oó]n bancaria|registrar comisi[oó]n|aprobar gasto|autorizar reparaci[oó]n|cerrar mantenimiento|modificar contrato|devoluci[oó]n|cancelaci[oó]n|negociaci[oó]n|jur[ií]dico|movimiento de dinero)';
  if v_forbidden then raise exception 'r1_sensitive_operation_blocked' using errcode='42501'; end if;

  select * into v_existing from public.administrative_work_history where idempotency_key=btrim(p_idempotency_key);
  if found then return jsonb_build_object('idempotent',true,'workItemId',v_existing.work_item_id,'historyId',v_existing.id); end if;

  if p_action='create_administrative_pending' then
    insert into public.administrative_work_items(domain,work_type,title,status,priority,client_identity_id,contract_id,property_id,condominium_id,unit_id,responsible_area,responsible_profile_id,primary_source_type,primary_source_id,source_context_key,dedupe_key,next_step,follow_up_at,requires_authorization,automation_mode)
    values(p_input->>'domain',p_input->>'workType',p_input->>'title','open',coalesce(p_input->>'priority','P2'),nullif(p_input->>'clientIdentityId','')::uuid,nullif(p_input->>'contractId','')::uuid,nullif(p_input->>'propertyId','')::uuid,nullif(p_input->>'condominiumId','')::uuid,nullif(p_input->>'unitId','')::uuid,coalesce(nullif(btrim(p_input->>'responsibleArea'),''),'Administración'),nullif(p_input->>'responsibleProfileId','')::uuid,p_input->>'sourceType',p_input->>'sourceId',nullif(p_input->>'sourceContextKey',''),p_input->>'dedupeKey',nullif(p_input->>'nextStep',''),nullif(p_input->>'followUpAt','')::timestamptz,coalesce((p_input->>'requiresAuthorization')::boolean,false),'manual')
    on conflict(dedupe_key) do update set updated_at=public.administrative_work_items.updated_at
    returning * into v_item;
    v_action_type:='created';
  else
    v_work_id:=nullif(p_input->>'workItemId','')::uuid;
    select * into v_item from public.administrative_work_items where id=v_work_id for update;
    if not found then raise exception 'work_item_not_found' using errcode='P0002'; end if;
    if v_item.status in ('resolved','cancelled') then raise exception 'r1_terminal_work_blocked' using errcode='42501'; end if;
    v_before:=to_jsonb(v_item);
    if p_action='append_structured_internal_note' then v_action_type:='note_added';
    elsif p_action='link_received_evidence' then
      insert into public.administrative_work_evidence(work_item_id,evidence_type,reference_type,reference_id,evidence_key,summary_safe,received_at)
      values(v_item.id,p_input->>'evidenceType',p_input->>'referenceType',p_input->>'referenceId',p_input->>'evidenceKey',nullif(p_input->>'summarySafe',''),coalesce(nullif(p_input->>'receivedAt','')::timestamptz,now())) on conflict(evidence_key) do nothing;
      v_action_type:='evidence_linked';
    elsif p_action='mark_information_received' then update public.administrative_work_items set information_received_at=coalesce(nullif(p_input->>'receivedAt','')::timestamptz,now()),updated_at=now() where id=v_item.id returning * into v_item; v_action_type:='information_received';
    elsif p_action='set_nonfinancial_next_step' then update public.administrative_work_items set next_step=nullif(btrim(p_input->>'nextStep'),''),updated_at=now() where id=v_item.id returning * into v_item; v_action_type:='next_step_set';
    elsif p_action='schedule_nonfinancial_follow_up' then update public.administrative_work_items set follow_up_at=nullif(p_input->>'followUpAt','')::timestamptz,updated_at=now() where id=v_item.id returning * into v_item; v_action_type:='follow_up_scheduled';
    elsif p_action='mark_possible_duplicate' then update public.administrative_work_items set duplicate_of_id=nullif(p_input->>'duplicateOfId','')::uuid,updated_at=now() where id=v_item.id returning * into v_item; v_action_type:='possible_duplicate';
    elsif p_action='assign_operational_responsible' then update public.administrative_work_items set responsible_profile_id=nullif(p_input->>'responsibleProfileId','')::uuid,updated_at=now() where id=v_item.id returning * into v_item; v_action_type:='responsible_assigned';
    end if;
  end if;

  if nullif(p_input->>'sourceLinkKey','') is not null then
    insert into public.administrative_work_source_links(work_item_id,source_type,source_id,source_event_key,link_key)
    values(v_item.id,p_input->>'sourceLinkType',p_input->>'sourceLinkId',nullif(p_input->>'sourceEventKey',''),p_input->>'sourceLinkKey') on conflict(link_key) do nothing;
  end if;
  insert into public.administrative_work_history(work_item_id,actor_type,actor_profile_id,action_type,previous_state,new_state,reason,capability,idempotency_key)
  values(v_item.id,p_actor_type,p_actor_profile_id,v_action_type,coalesce(v_before,'{}'::jsonb),to_jsonb(v_item),nullif(left(btrim(coalesce(p_input->>'reason','')),500),''),p_action,btrim(p_idempotency_key))
  returning * into v_existing;
  return jsonb_build_object('idempotent',false,'workItemId',v_item.id,'historyId',v_existing.id);
exception when unique_violation then
  select * into v_existing from public.administrative_work_history where idempotency_key=btrim(p_idempotency_key);
  if found then return jsonb_build_object('idempotent',true,'workItemId',v_existing.work_item_id,'historyId',v_existing.id); end if;
  raise;
end;
$$;

alter table public.administrative_work_items enable row level security;
alter table public.administrative_work_source_links enable row level security;
alter table public.administrative_work_evidence enable row level security;
alter table public.administrative_work_history enable row level security;
alter table public.administrative_work_approvals enable row level security;

revoke all on public.administrative_work_items,public.administrative_work_source_links,public.administrative_work_evidence,public.administrative_work_history,public.administrative_work_approvals from public,anon,authenticated,service_role;
grant select,insert,update on public.administrative_work_items to service_role;
grant select,insert on public.administrative_work_source_links,public.administrative_work_evidence,public.administrative_work_history,public.administrative_work_approvals to service_role;
grant select on public.administrative_work_items,public.administrative_work_source_links,public.administrative_work_evidence,public.administrative_work_history,public.administrative_work_approvals to authenticated;

create policy administrative_work_items_admin_read on public.administrative_work_items for select to authenticated using(public.current_profile_role_id() in ('admin','coord_operaciones'));
create policy administrative_work_sources_admin_read on public.administrative_work_source_links for select to authenticated using(public.current_profile_role_id() in ('admin','coord_operaciones'));
create policy administrative_work_evidence_admin_read on public.administrative_work_evidence for select to authenticated using(public.current_profile_role_id() in ('admin','coord_operaciones'));
create policy administrative_work_history_admin_read on public.administrative_work_history for select to authenticated using(public.current_profile_role_id() in ('admin','coord_operaciones'));
create policy administrative_work_approvals_admin_read on public.administrative_work_approvals for select to authenticated using(public.current_profile_role_id() in ('admin','coord_operaciones'));

revoke all on function public.execute_administrative_work_r1(text,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.execute_administrative_work_r1(text,jsonb,text,text,uuid) to service_role;

comment on table public.administrative_work_items is 'Hub durable único de Trabajo Administrativo; sin PII duplicada ni autonomía R2/R3';
comment on function public.execute_administrative_work_r1(text,jsonb,text,text,uuid) is 'Allowlist R1 transaccional/idempotente; capability de aplicación obligatoria y separada de outbound';

commit;
