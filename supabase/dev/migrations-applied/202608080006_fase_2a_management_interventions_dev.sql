-- Fase 2A DEV - Intervenciones gerenciales generales
-- Estado: ejecutable solo en inmoadmin-dev.
-- Objetivo: registrar intervenciones por asesor sin forzarlas a una oportunidad concreta.

begin;

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

create index if not exists idx_gv_management_interventions_advisor_status
  on public.gv_management_interventions (advisor_profile_id, status, created_at desc);

create index if not exists idx_gv_management_interventions_actor_created
  on public.gv_management_interventions (actor_profile_id, created_at desc);

alter table public.gv_management_interventions enable row level security;

grant select, insert, update on public.gv_management_interventions to authenticated;
grant select, insert, update, delete on public.gv_management_interventions to service_role;

drop policy if exists "gv_management_interventions_select_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_select_scope"
on public.gv_management_interventions
for select
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or advisor_profile_id = auth.uid()
  or actor_profile_id = auth.uid()
  or public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas'])
);

drop policy if exists "gv_management_interventions_insert_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_insert_scope"
on public.gv_management_interventions
for insert
to authenticated
with check (
  actor_profile_id = auth.uid()
  and scope = 'ventas'
  and (
    public.current_profile_role_id() = 'admin'
    or public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas'])
  )
);

drop policy if exists "gv_management_interventions_update_scope" on public.gv_management_interventions;
create policy "gv_management_interventions_update_scope"
on public.gv_management_interventions
for update
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or actor_profile_id = auth.uid()
  or public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas'])
)
with check (
  scope = 'ventas'
  and (
    public.current_profile_role_id() = 'admin'
    or actor_profile_id = auth.uid()
    or public.can_supervise_profile_in_scope(advisor_profile_id, array['ventas'])
  )
);

comment on table public.gv_management_interventions is
  'Fase 2A DEV: intervenciones gerenciales generales por asesor. No es Score Gerencial oficial.';

commit;
