-- Fase 2A Gerencia de Ventas - base estructural revisable
-- Estado: NO EJECUTADA.
-- Objetivo: preparar oportunidades, disponibilidad comercial, auditoria,
-- clasificacion estructurada de cierres y bases para "Mi trabajo / Supervisar".
--
-- Principios:
-- - Migracion aditiva.
-- - Sin backfill automatico.
-- - Sin eliminar ni renombrar columnas existentes.
-- - Sin reinterpretar cierres historicos ambiguos.
-- - RLS habilitado desde la creacion de tablas nuevas.
-- - Las acciones siempre conservan auth.uid() como usuario real.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers de autorizacion
-- ---------------------------------------------------------------------------

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

create or replace function public.is_internal_management_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role_id() in ('admin', 'gerente_ventas', 'coord_operaciones'), false)
$$;

-- Tabla jerarquica ligera. No implementa UI; solo evita bloquear el modelo
-- futuro de supervision. Una persona puede supervisar a otra durante un rango.
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
  constraint gv_supervision_edges_no_self
    check (supervisor_profile_id <> subordinate_profile_id),
  constraint gv_supervision_edges_valid_range
    check (ends_on is null or ends_on >= starts_on)
);

create index if not exists idx_gv_supervision_edges_supervisor
  on public.gv_supervision_edges (supervisor_profile_id, active, starts_on, ends_on);

create index if not exists idx_gv_supervision_edges_subordinate
  on public.gv_supervision_edges (subordinate_profile_id, active, starts_on, ends_on);

create unique index if not exists uq_gv_supervision_edges_active_scope
  on public.gv_supervision_edges (supervisor_profile_id, subordinate_profile_id, scope)
  where active = true and ends_on is null;

create or replace function public.can_supervise_profile(target_profile_id uuid)
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
    when public.current_profile_role_id() in ('gerente_ventas', 'coord_operaciones') then exists (
      select 1
      from public.gv_supervision_edges e
      where e.supervisor_profile_id = auth.uid()
        and e.subordinate_profile_id = target_profile_id
        and e.active = true
        and e.starts_on <= current_date
        and (e.ends_on is null or e.ends_on >= current_date)
    )
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Disponibilidad/capacidad evaluable
-- ---------------------------------------------------------------------------

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
  constraint gv_advisor_availability_valid_range
    check (ends_on is null or ends_on >= starts_on)
);

create index if not exists idx_gv_advisor_availability_profile_period
  on public.gv_advisor_availability (profile_id, starts_on, ends_on);

create index if not exists idx_gv_advisor_availability_status
  on public.gv_advisor_availability (status, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- Oportunidades comerciales
-- ---------------------------------------------------------------------------

create table if not exists public.gv_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cliente_id uuid null references public.clientes(id),
  propiedad_id uuid null references public.propiedades(id),
  asesor_id uuid not null references public.profiles(id),
  owner_profile_id uuid null references public.profiles(id),
  stage text not null default 'lead'
    check (stage in (
      'lead',
      'contactado',
      'cita_agendada',
      'cita_calificada',
      'oferta',
      'apartado',
      'contrato_firma',
      'cierre_ganado',
      'cierre_perdido',
      'pausado'
    )),
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
  cierre_id uuid null references public.cierres(id),
  lost_reason text null,
  lost_reason_category text null
    check (lost_reason_category is null or lost_reason_category in (
      'precio',
      'credito',
      'documentacion',
      'competencia',
      'cliente_no_contesta',
      'propietario',
      'externa',
      'otro'
    )),
  offer_amount numeric(14,2) null check (offer_amount >= 0),
  apartado_amount numeric(14,2) null check (apartado_amount >= 0),
  source text not null default 'manual'
    check (source in ('manual', 'respond_io', 'easybroker', 'recibo_apartado', 'cita', 'importacion', 'otro')),
  source_external_id text null,
  respond_contact_id text null,
  respond_conversation_id text null,
  respond_channel text null,
  respond_assignee_id text null,
  respond_status text null,
  respond_first_activity_at timestamptz null,
  respond_last_inbound_at timestamptz null,
  respond_last_outbound_at timestamptz null,
  respond_metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz null,
  last_activity_at timestamptz null,
  notes text null,
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint gv_opportunities_close_consistency
    check (
      (stage = 'cierre_ganado' and closed_at is not null)
      or stage <> 'cierre_ganado'
    )
);

create index if not exists idx_gv_opportunities_asesor_stage
  on public.gv_opportunities (asesor_id, stage);

create index if not exists idx_gv_opportunities_expected_close
  on public.gv_opportunities (expected_close_date, forecast_category);

create index if not exists idx_gv_opportunities_next_action
  on public.gv_opportunities (next_action_at)
  where next_action_at is not null;

create index if not exists idx_gv_opportunities_risk
  on public.gv_opportunities (risk_level, last_activity_at);

create index if not exists idx_gv_opportunities_operation_type
  on public.gv_opportunities (operation_type);

create index if not exists idx_gv_opportunities_cliente
  on public.gv_opportunities (cliente_id);

create index if not exists idx_gv_opportunities_cierre
  on public.gv_opportunities (cierre_id);

create index if not exists idx_gv_opportunities_respond_contact
  on public.gv_opportunities (respond_contact_id)
  where respond_contact_id is not null;

create index if not exists idx_gv_opportunities_respond_conversation
  on public.gv_opportunities (respond_conversation_id)
  where respond_conversation_id is not null;

create unique index if not exists uq_gv_opportunities_source_external
  on public.gv_opportunities (source, source_external_id)
  where source_external_id is not null;

-- Auditoria de eventos. No reemplaza tablas operativas actuales.
create table if not exists public.gv_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.gv_opportunities(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'created',
      'stage_changed',
      'advisor_changed',
      'forecast_changed',
      'next_action_changed',
      'next_action_date_changed',
      'risk_changed',
      'offer_updated',
      'apartado_updated',
      'activity_logged',
      'linked_cierre',
      'closed_won',
      'closed_lost',
      'lost_reason_classified',
      'management_intervention',
      'external_sync',
      'note'
    )),
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

create index if not exists idx_gv_opportunity_events_opportunity
  on public.gv_opportunity_events (opportunity_id, occurred_at desc);

create index if not exists idx_gv_opportunity_events_actor
  on public.gv_opportunity_events (actor_profile_id, occurred_at desc);

create index if not exists idx_gv_opportunity_events_type
  on public.gv_opportunity_events (event_type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Transicion no destructiva de cierres.vendedor
-- ---------------------------------------------------------------------------

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

create index if not exists idx_cierres_advisor_profile_id
  on public.cierres (advisor_profile_id)
  where advisor_profile_id is not null;

create index if not exists idx_cierres_operation_type_structured
  on public.cierres (operation_type_structured)
  where operation_type_structured is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.gv_supervision_edges enable row level security;
alter table public.gv_advisor_availability enable row level security;
alter table public.gv_opportunities enable row level security;
alter table public.gv_opportunity_events enable row level security;

drop policy if exists "gv_supervision_edges_select_management" on public.gv_supervision_edges;
create policy "gv_supervision_edges_select_management"
on public.gv_supervision_edges
for select
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or supervisor_profile_id = auth.uid()
  or subordinate_profile_id = auth.uid()
);

drop policy if exists "gv_supervision_edges_write_admin" on public.gv_supervision_edges;
create policy "gv_supervision_edges_write_admin"
on public.gv_supervision_edges
for all
to authenticated
using (public.current_profile_role_id() = 'admin')
with check (public.current_profile_role_id() = 'admin');

drop policy if exists "gv_advisor_availability_select_scope" on public.gv_advisor_availability;
create policy "gv_advisor_availability_select_scope"
on public.gv_advisor_availability
for select
to authenticated
using (
  public.can_supervise_profile(profile_id)
);

drop policy if exists "gv_advisor_availability_write_management" on public.gv_advisor_availability;
create policy "gv_advisor_availability_write_management"
on public.gv_advisor_availability
for all
to authenticated
using (
  public.current_profile_role_id() in ('admin', 'gerente_ventas', 'coord_operaciones')
)
with check (
  public.current_profile_role_id() in ('admin', 'gerente_ventas', 'coord_operaciones')
  and (
    public.current_profile_role_id() = 'admin'
    or public.can_supervise_profile(profile_id)
  )
);

drop policy if exists "gv_opportunities_select_scope" on public.gv_opportunities;
create policy "gv_opportunities_select_scope"
on public.gv_opportunities
for select
to authenticated
using (
  public.can_supervise_profile(asesor_id)
  or public.can_supervise_profile(owner_profile_id)
);

drop policy if exists "gv_opportunities_insert_scope" on public.gv_opportunities;
create policy "gv_opportunities_insert_scope"
on public.gv_opportunities
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    asesor_id = auth.uid()
    or public.can_supervise_profile(asesor_id)
  )
);

drop policy if exists "gv_opportunities_update_scope" on public.gv_opportunities;
create policy "gv_opportunities_update_scope"
on public.gv_opportunities
for update
to authenticated
using (
  asesor_id = auth.uid()
  or public.can_supervise_profile(asesor_id)
)
with check (
  updated_by = auth.uid()
  and (
    asesor_id = auth.uid()
    or public.can_supervise_profile(asesor_id)
  )
);

drop policy if exists "gv_opportunities_delete_admin" on public.gv_opportunities;
create policy "gv_opportunities_delete_admin"
on public.gv_opportunities
for delete
to authenticated
using (
  public.current_profile_role_id() = 'admin'
);

drop policy if exists "gv_opportunity_events_select_scope" on public.gv_opportunity_events;
create policy "gv_opportunity_events_select_scope"
on public.gv_opportunity_events
for select
to authenticated
using (
  exists (
    select 1
    from public.gv_opportunities o
    where o.id = opportunity_id
      and (
        public.can_supervise_profile(o.asesor_id)
        or public.can_supervise_profile(o.owner_profile_id)
      )
  )
);

drop policy if exists "gv_opportunity_events_insert_scope" on public.gv_opportunity_events;
create policy "gv_opportunity_events_insert_scope"
on public.gv_opportunity_events
for insert
to authenticated
with check (
  actor_profile_id = auth.uid()
  and exists (
    select 1
    from public.gv_opportunities o
    where o.id = opportunity_id
      and (
        o.asesor_id = auth.uid()
        or public.can_supervise_profile(o.asesor_id)
      )
  )
);

commit;
