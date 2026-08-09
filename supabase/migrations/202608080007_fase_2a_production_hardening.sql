-- Fase 2A - Production hardening
-- Migracion aditiva e idempotente para Mi Trabajo / Mi Gerencia.
-- No inserta datos, no ejecuta seed y no reinterpreta citas historicas.

begin;

create extension if not exists pgcrypto;

create or replace function public.current_profile_role_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true
  limit 1
$$;

revoke all on function public.current_profile_role_id() from public, anon;
grant execute on function public.current_profile_role_id() to authenticated, service_role;

create table if not exists public.gv_supervision_edges (
  id uuid primary key default gen_random_uuid(),
  supervisor_profile_id uuid not null references public.profiles(id),
  subordinate_profile_id uuid not null references public.profiles(id),
  scope text not null default 'ventas'
    check (scope in ('ventas', 'operaciones', 'administracion', 'juridico', 'global')),
  starts_on date not null default current_date,
  ends_on date null,
  active boolean not null default true,
  notes text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint gv_supervision_edges_no_self check (supervisor_profile_id <> subordinate_profile_id),
  constraint gv_supervision_edges_valid_range check (ends_on is null or ends_on >= starts_on)
);

alter table public.gv_supervision_edges
  add column if not exists supervisor_profile_id uuid references public.profiles(id),
  add column if not exists subordinate_profile_id uuid references public.profiles(id),
  add column if not exists scope text not null default 'ventas',
  add column if not exists starts_on date not null default current_date,
  add column if not exists ends_on date null,
  add column if not exists active boolean not null default true,
  add column if not exists notes text null,
  add column if not exists created_by uuid null references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid null references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_gv_supervision_edges_supervisor
  on public.gv_supervision_edges (supervisor_profile_id, scope, active, starts_on, ends_on);
create index if not exists idx_gv_supervision_edges_subordinate
  on public.gv_supervision_edges (subordinate_profile_id, scope, active, starts_on, ends_on);
create unique index if not exists uq_gv_supervision_edges_active_scope
  on public.gv_supervision_edges (supervisor_profile_id, subordinate_profile_id, scope)
  where active = true and ends_on is null;

create or replace function public.can_supervise_profile_in_scope(
  target_profile_id uuid,
  allowed_scopes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when target_profile_id = auth.uid() then true
    when public.current_profile_role_id() = 'admin' then true
    when public.current_profile_role_id() = 'gerente_ventas' then exists (
      select 1
      from public.gv_supervision_edges e
      where e.supervisor_profile_id = auth.uid()
        and e.subordinate_profile_id = target_profile_id
        and e.active = true
        and e.scope = any(allowed_scopes)
        and e.starts_on <= current_date
        and (e.ends_on is null or e.ends_on >= current_date)
    )
    else false
  end
$$;

revoke all on function public.can_supervise_profile_in_scope(uuid, text[]) from public, anon;
grant execute on function public.can_supervise_profile_in_scope(uuid, text[]) to authenticated, service_role;

create table if not exists public.gv_advisor_availability (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  starts_on date not null,
  ends_on date null,
  status text not null
    check (status in ('evaluable', 'ausencia_temporal', 'fuera_temporal', 'baja_no_evaluable')),
  capacity_weight numeric(4,3) not null default 1
    check (capacity_weight >= 0 and capacity_weight <= 1),
  reason text not null,
  notes text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint gv_advisor_availability_valid_range check (ends_on is null or ends_on >= starts_on)
);

alter table public.gv_advisor_availability
  add column if not exists profile_id uuid references public.profiles(id),
  add column if not exists starts_on date,
  add column if not exists ends_on date null,
  add column if not exists status text,
  add column if not exists capacity_weight numeric(4,3) not null default 1,
  add column if not exists reason text,
  add column if not exists notes text null,
  add column if not exists created_by uuid null references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid null references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_gv_advisor_availability_profile_period
  on public.gv_advisor_availability (profile_id, starts_on, ends_on);
create index if not exists idx_gv_advisor_availability_status
  on public.gv_advisor_availability (status, starts_on, ends_on);

create table if not exists public.gv_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cliente_id uuid null references public.clientes(id),
  propiedad_id uuid null references public.propiedades(id),
  asesor_id uuid not null references public.profiles(id),
  owner_profile_id uuid null references public.profiles(id),
  stage text not null default 'lead'
    check (stage in ('lead', 'contactado', 'cita_agendada', 'cita_calificada', 'oferta', 'apartado', 'contrato_firma', 'cierre_ganado', 'cierre_perdido', 'pausado')),
  operation_type text not null default 'nueva'
    check (operation_type in ('nueva', 'renovacion', 'otro')),
  forecast_category text not null default 'pipeline'
    check (forecast_category in ('pipeline', 'best_case', 'commit', 'omitido')),
  probability_pct integer null check (probability_pct between 0 and 100),
  estimated_price numeric(14,2) null check (estimated_price >= 0),
  estimated_commission numeric(14,2) null check (estimated_commission >= 0),
  expected_close_date date null,
  next_action text null,
  next_action_at timestamptz null,
  risk_level text not null default 'normal'
    check (risk_level in ('bajo', 'normal', 'alto', 'critico')),
  risk_reason text null,
  qualified_at timestamptz null,
  closed_at timestamptz null,
  cierre_id bigint null references public.cierres(id),
  lost_reason text null,
  lost_reason_category text null
    check (lost_reason_category is null or lost_reason_category in ('precio', 'credito', 'documentacion', 'competencia', 'cliente_no_contesta', 'propietario', 'externa', 'otro')),
  offer_amount numeric(14,2) null check (offer_amount >= 0),
  apartado_amount numeric(14,2) null check (apartado_amount >= 0),
  source text not null default 'manual'
    check (source in ('manual', 'respond_io', 'easybroker', 'recibo_apartado', 'cita', 'importacion', 'otro')),
  source_external_id text null,
  respond_contact_id text null,
  respond_conversation_id text null,
  respond_channel text null,
  respond_assignee_id text null,
  respond_assignee_email text null,
  respond_channel_id text null,
  respond_channel_source text null,
  respond_status text null,
  respond_conversation_status text null,
  respond_lifecycle text null,
  respond_first_activity_at timestamptz null,
  respond_last_inbound_at timestamptz null,
  respond_last_outbound_at timestamptz null,
  respond_last_human_outbound_at timestamptz null,
  respond_last_ai_outbound_at timestamptz null,
  respond_unanswered_since timestamptz null,
  respond_metadata jsonb not null default '{}'::jsonb,
  respond_last_synced_at timestamptz null,
  last_synced_at timestamptz null,
  last_activity_at timestamptz null,
  notes text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint gv_opportunities_close_consistency
    check ((stage = 'cierre_ganado' and closed_at is not null) or stage <> 'cierre_ganado')
);

alter table public.gv_opportunities
  add column if not exists cliente_id uuid null references public.clientes(id),
  add column if not exists propiedad_id uuid null references public.propiedades(id),
  add column if not exists asesor_id uuid references public.profiles(id),
  add column if not exists owner_profile_id uuid null references public.profiles(id),
  add column if not exists operation_type text not null default 'nueva',
  add column if not exists forecast_category text not null default 'pipeline',
  add column if not exists probability_pct integer null,
  add column if not exists estimated_price numeric(14,2) null,
  add column if not exists estimated_commission numeric(14,2) null,
  add column if not exists expected_close_date date null,
  add column if not exists next_action text null,
  add column if not exists next_action_at timestamptz null,
  add column if not exists risk_level text not null default 'normal',
  add column if not exists risk_reason text null,
  add column if not exists qualified_at timestamptz null,
  add column if not exists closed_at timestamptz null,
  add column if not exists cierre_id bigint null references public.cierres(id),
  add column if not exists source text not null default 'manual',
  add column if not exists source_external_id text null,
  add column if not exists respond_contact_id text null,
  add column if not exists respond_conversation_id text null,
  add column if not exists respond_channel text null,
  add column if not exists respond_assignee_id text null,
  add column if not exists respond_assignee_email text null,
  add column if not exists respond_channel_id text null,
  add column if not exists respond_channel_source text null,
  add column if not exists respond_status text null,
  add column if not exists respond_conversation_status text null,
  add column if not exists respond_lifecycle text null,
  add column if not exists respond_first_activity_at timestamptz null,
  add column if not exists respond_last_inbound_at timestamptz null,
  add column if not exists respond_last_outbound_at timestamptz null,
  add column if not exists respond_last_human_outbound_at timestamptz null,
  add column if not exists respond_last_ai_outbound_at timestamptz null,
  add column if not exists respond_unanswered_since timestamptz null,
  add column if not exists respond_metadata jsonb not null default '{}'::jsonb,
  add column if not exists respond_last_synced_at timestamptz null,
  add column if not exists last_synced_at timestamptz null,
  add column if not exists last_activity_at timestamptz null,
  add column if not exists notes text null,
  add column if not exists created_by uuid null references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid null references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_gv_opportunities_asesor_stage on public.gv_opportunities (asesor_id, stage);
create index if not exists idx_gv_opportunities_next_action on public.gv_opportunities (next_action_at) where next_action_at is not null;
create index if not exists idx_gv_opportunities_risk on public.gv_opportunities (risk_level, last_activity_at);
create index if not exists idx_gv_opportunities_operation_type on public.gv_opportunities (operation_type);
create index if not exists idx_gv_opportunities_cliente on public.gv_opportunities (cliente_id);
create index if not exists idx_gv_opportunities_cierre on public.gv_opportunities (cierre_id);
create index if not exists idx_gv_opportunities_respond_contact on public.gv_opportunities (respond_contact_id) where respond_contact_id is not null;
create unique index if not exists uq_gv_opportunities_source_external
  on public.gv_opportunities (source, source_external_id)
  where source_external_id is not null;

create table if not exists public.gv_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.gv_opportunities(id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'stage_changed', 'advisor_changed', 'forecast_changed', 'next_action_changed', 'next_action_date_changed', 'risk_changed', 'offer_updated', 'apartado_updated', 'activity_logged', 'linked_cierre', 'closed_won', 'closed_lost', 'lost_reason_classified', 'management_intervention', 'external_sync', 'note')),
  field_name text null,
  old_value jsonb null,
  new_value jsonb null,
  occurred_at timestamptz not null default now(),
  actor_profile_id uuid not null references public.profiles(id),
  acted_as_profile_id uuid null references public.profiles(id),
  is_management_intervention boolean not null default false,
  event_source text not null default 'app'
    check (event_source in ('app', 'system', 'respond_io_sync', 'manual_admin')),
  metadata jsonb not null default '{}'::jsonb,
  notes text null,
  constraint gv_opportunity_events_no_technical_impersonation
    check (acted_as_profile_id is null or acted_as_profile_id <> actor_profile_id)
);

create index if not exists idx_gv_opportunity_events_opportunity on public.gv_opportunity_events (opportunity_id, occurred_at desc);
create index if not exists idx_gv_opportunity_events_actor on public.gv_opportunity_events (actor_profile_id, occurred_at desc);

create table if not exists public.gv_respond_contact_snapshots (
  id uuid primary key default gen_random_uuid(),
  respond_contact_id text not null,
  respond_assignee_id text null,
  respond_assignee_email text null,
  mapped_profile_id uuid null references public.profiles(id),
  mapping_status text not null default 'unmatched'
    check (mapping_status in ('matched', 'unmatched', 'ambiguous', 'bot')),
  respond_channel_id text null,
  respond_channel_source text null,
  respond_conversation_status text null,
  respond_lifecycle text null,
  respond_last_inbound_at timestamptz null,
  respond_last_outbound_at timestamptz null,
  respond_last_human_outbound_at timestamptz null,
  respond_last_ai_outbound_at timestamptz null,
  respond_unanswered_since timestamptz null,
  respond_last_synced_at timestamptz not null default now(),
  atn_area text null,
  atn_servicio text null,
  atn_estado text null,
  atn_destino text null,
  atn_proxima_accion text null,
  atn_fecha_proxima_accion date null,
  atn_sla_vencido boolean null,
  ven_presupuesto_compra numeric(14,2) null,
  ven_renta_mensual_objetivo numeric(14,2) null,
  ven_plazo text null,
  inm_tipo text null,
  inm_zona text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (respond_contact_id)
);

alter table public.gv_respond_contact_snapshots
  add column if not exists respond_contact_id text,
  add column if not exists respond_assignee_id text null,
  add column if not exists respond_assignee_email text null,
  add column if not exists mapped_profile_id uuid null references public.profiles(id),
  add column if not exists mapping_status text not null default 'unmatched',
  add column if not exists respond_channel_id text null,
  add column if not exists respond_channel_source text null,
  add column if not exists respond_conversation_status text null,
  add column if not exists respond_lifecycle text null,
  add column if not exists respond_last_inbound_at timestamptz null,
  add column if not exists respond_last_outbound_at timestamptz null,
  add column if not exists respond_last_human_outbound_at timestamptz null,
  add column if not exists respond_last_ai_outbound_at timestamptz null,
  add column if not exists respond_unanswered_since timestamptz null,
  add column if not exists respond_last_synced_at timestamptz not null default now(),
  add column if not exists atn_area text null,
  add column if not exists atn_servicio text null,
  add column if not exists atn_estado text null,
  add column if not exists atn_destino text null,
  add column if not exists atn_proxima_accion text null,
  add column if not exists atn_fecha_proxima_accion date null,
  add column if not exists atn_sla_vencido boolean null,
  add column if not exists ven_presupuesto_compra numeric(14,2) null,
  add column if not exists ven_renta_mensual_objetivo numeric(14,2) null,
  add column if not exists ven_plazo text null,
  add column if not exists inm_tipo text null,
  add column if not exists inm_zona text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_gv_respond_snapshots_profile on public.gv_respond_contact_snapshots (mapped_profile_id, respond_conversation_status);
create index if not exists idx_gv_respond_snapshots_unanswered on public.gv_respond_contact_snapshots (respond_unanswered_since) where respond_unanswered_since is not null;
create unique index if not exists uq_gv_respond_snapshots_contact
  on public.gv_respond_contact_snapshots (respond_contact_id);

create table if not exists public.gv_management_interventions (
  id uuid primary key default gen_random_uuid(),
  advisor_profile_id uuid not null references public.profiles(id),
  actor_profile_id uuid not null references public.profiles(id),
  scope text not null default 'ventas',
  reason text not null,
  agreed_action text not null,
  review_on date null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'en_seguimiento', 'corregida', 'sin_mejora', 'cerrada_decision_tomada')),
  indicators jsonb not null default '{}'::jsonb,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gv_management_interventions
  add column if not exists advisor_profile_id uuid references public.profiles(id),
  add column if not exists actor_profile_id uuid references public.profiles(id),
  add column if not exists scope text not null default 'ventas',
  add column if not exists reason text,
  add column if not exists agreed_action text,
  add column if not exists review_on date null,
  add column if not exists status text not null default 'pendiente',
  add column if not exists indicators jsonb not null default '{}'::jsonb,
  add column if not exists notes text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_gv_management_interventions_advisor_status
  on public.gv_management_interventions (advisor_profile_id, status, created_at desc);
create index if not exists idx_gv_management_interventions_actor_created
  on public.gv_management_interventions (actor_profile_id, created_at desc);
create unique index if not exists uq_gv_management_interventions_active_context
  on public.gv_management_interventions (advisor_profile_id, scope, (indicators->>'contextKey'))
  where status in ('pendiente', 'en_seguimiento', 'sin_mejora')
    and indicators ? 'contextKey';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gv_management_interventions_context_key_not_blank'
      and conrelid = 'public.gv_management_interventions'::regclass
  ) then
    alter table public.gv_management_interventions
      add constraint gv_management_interventions_context_key_not_blank
      check (
        not (indicators ? 'contextKey')
        or length(trim(indicators->>'contextKey')) > 0
      ) not valid;
  end if;
end $$;

alter table public.cierres
  add column if not exists advisor_profile_id uuid null references public.profiles(id),
  add column if not exists operation_type_structured text null
    check (operation_type_structured in ('nueva', 'renovacion', 'otro')),
  add column if not exists operation_type_confidence text null
    check (operation_type_confidence in ('manual_confirmed', 'system_suggested', 'ambiguous', 'unknown')),
  add column if not exists operation_type_source text null,
  add column if not exists classified_by uuid null references auth.users(id),
  add column if not exists classified_at timestamptz null,
  add column if not exists classification_notes text null;

create index if not exists idx_cierres_advisor_profile_id on public.cierres (advisor_profile_id) where advisor_profile_id is not null;
create index if not exists idx_cierres_operation_type_structured on public.cierres (operation_type_structured) where operation_type_structured is not null;

alter table public.citas
  add column if not exists confirmacion_estado text null,
  add column if not exists confirmacion_actualizada_at timestamptz null,
  add column if not exists confirmacion_actualizada_por uuid null references public.profiles(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'citas_confirmacion_estado_check'
      and conrelid = 'public.citas'::regclass
  ) then
    alter table public.citas
      add constraint citas_confirmacion_estado_check
      check (confirmacion_estado is null or confirmacion_estado in ('pendiente_confirmar', 'confirmada', 'cancelada', 'no_show', 'realizada'));
  end if;
end $$;

create index if not exists idx_citas_asesor_confirmacion_fecha on public.citas (asesor_id, confirmacion_estado, fecha_hora);

alter table public.gv_supervision_edges enable row level security;
alter table public.gv_advisor_availability enable row level security;
alter table public.gv_opportunities enable row level security;
alter table public.gv_opportunity_events enable row level security;
alter table public.gv_respond_contact_snapshots enable row level security;
alter table public.gv_management_interventions enable row level security;

grant select on public.gv_supervision_edges to authenticated;
grant select on public.gv_advisor_availability to authenticated;
grant select on public.gv_opportunities to authenticated;
grant select, insert on public.gv_opportunity_events to authenticated;
grant select on public.gv_respond_contact_snapshots to authenticated;
grant select, insert, update on public.gv_management_interventions to authenticated;
grant select, insert, update, delete on
  public.gv_supervision_edges,
  public.gv_advisor_availability,
  public.gv_opportunities,
  public.gv_opportunity_events,
  public.gv_respond_contact_snapshots,
  public.gv_management_interventions
to service_role;

drop policy if exists "gv_supervision_edges_select_scope" on public.gv_supervision_edges;
create policy "gv_supervision_edges_select_scope" on public.gv_supervision_edges
for select to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or supervisor_profile_id = auth.uid()
  or subordinate_profile_id = auth.uid()
);

drop policy if exists "gv_supervision_edges_write_admin" on public.gv_supervision_edges;
create policy "gv_supervision_edges_write_admin" on public.gv_supervision_edges
for all to authenticated
using (public.current_profile_role_id() = 'admin')
with check (public.current_profile_role_id() = 'admin');

drop policy if exists "gv_advisor_availability_select_scope" on public.gv_advisor_availability;
create policy "gv_advisor_availability_select_scope" on public.gv_advisor_availability
for select to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or profile_id = auth.uid()
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(profile_id, array['ventas', 'global'])
  )
);

drop policy if exists "gv_advisor_availability_write_admin" on public.gv_advisor_availability;
create policy "gv_advisor_availability_write_admin" on public.gv_advisor_availability
for all to authenticated
using (public.current_profile_role_id() = 'admin')
with check (public.current_profile_role_id() = 'admin');

drop policy if exists "gv_opportunities_select_scope" on public.gv_opportunities;
create policy "gv_opportunities_select_scope" on public.gv_opportunities
for select to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or asesor_id = auth.uid()
  or public.can_supervise_profile_in_scope(asesor_id, array['ventas', 'global'])
);

drop policy if exists "gv_opportunities_write_admin" on public.gv_opportunities;
create policy "gv_opportunities_write_admin" on public.gv_opportunities
for all to authenticated
using (public.current_profile_role_id() = 'admin')
with check (public.current_profile_role_id() = 'admin');

drop policy if exists "gv_opportunity_events_select_scope" on public.gv_opportunity_events;
create policy "gv_opportunity_events_select_scope" on public.gv_opportunity_events
for select to authenticated
using (
  exists (
    select 1 from public.gv_opportunities o
    where o.id = opportunity_id
      and (
        public.current_profile_role_id() = 'admin'
        or o.asesor_id = auth.uid()
        or public.can_supervise_profile_in_scope(o.asesor_id, array['ventas', 'global'])
      )
  )
);

drop policy if exists "gv_opportunity_events_insert_scope" on public.gv_opportunity_events;
create policy "gv_opportunity_events_insert_scope" on public.gv_opportunity_events
for insert to authenticated
with check (
  actor_profile_id = auth.uid()
  and exists (
    select 1 from public.gv_opportunities o
    where o.id = opportunity_id
      and (
        o.asesor_id = auth.uid()
        or public.current_profile_role_id() = 'admin'
        or public.can_supervise_profile_in_scope(o.asesor_id, array['ventas', 'global'])
      )
  )
);

drop policy if exists "gv_respond_snapshots_select_scope" on public.gv_respond_contact_snapshots;
create policy "gv_respond_snapshots_select_scope" on public.gv_respond_contact_snapshots
for select to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or mapped_profile_id = auth.uid()
  or (
    mapped_profile_id is not null
    and public.can_supervise_profile_in_scope(mapped_profile_id, array['ventas', 'global'])
  )
);

drop policy if exists "gv_management_interventions_select_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_select_scope" on public.gv_management_interventions
for select to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and (
      actor_profile_id = auth.uid()
      or public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas', 'global'])
    )
  )
);

drop policy if exists "gv_management_interventions_insert_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_insert_scope" on public.gv_management_interventions
for insert to authenticated
with check (
  actor_profile_id = auth.uid()
  and scope = 'ventas'
  and (
    public.current_profile_role_id() = 'admin'
    or (
      public.current_profile_role_id() = 'gerente_ventas'
      and public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas', 'global'])
    )
  )
);

drop policy if exists "gv_management_interventions_update_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_update_scope" on public.gv_management_interventions
for update to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or (
    public.current_profile_role_id() = 'gerente_ventas'
    and public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas', 'global'])
  )
)
with check (
  scope = 'ventas'
  and (
    public.current_profile_role_id() = 'admin'
    or (
      public.current_profile_role_id() = 'gerente_ventas'
      and public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas', 'global'])
    )
  )
);

comment on table public.gv_management_interventions is
  'Fase 2A: intervenciones gerenciales por asesor. SELECT limitado a admin/gerente_ventas; asesores no leen notas gerenciales. No es Score Gerencial oficial.';
comment on column public.citas.confirmacion_estado is
  'Fase 2A: estado operativo de confirmacion de cita. Null conserva lectura legacy sin backfill automatico.';

commit;
