-- Fase 2A DEV - Respond.io metadata + Centro de Trabajo
-- Estado: ejecutable solo en inmoadmin-dev.
-- Objetivo: habilitar prototipo "Mi Trabajo / Mi Gerencia / Supervisar".
-- No almacena cuerpos de mensajes, adjuntos, audios ni transcripciones.

begin;

alter table public.gv_opportunities
  add column if not exists respond_assignee_email text null,
  add column if not exists respond_channel_id text null,
  add column if not exists respond_channel_source text null,
  add column if not exists respond_conversation_status text null,
  add column if not exists respond_lifecycle text null,
  add column if not exists respond_last_human_outbound_at timestamptz null,
  add column if not exists respond_last_ai_outbound_at timestamptz null,
  add column if not exists respond_unanswered_since timestamptz null,
  add column if not exists respond_last_synced_at timestamptz null;

create index if not exists idx_gv_opportunities_respond_unanswered
  on public.gv_opportunities (respond_unanswered_since)
  where respond_unanswered_since is not null;

create index if not exists idx_gv_opportunities_respond_assignee_email
  on public.gv_opportunities (respond_assignee_email)
  where respond_assignee_email is not null;

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

create index if not exists idx_gv_respond_snapshots_profile
  on public.gv_respond_contact_snapshots (mapped_profile_id, respond_conversation_status);

create index if not exists idx_gv_respond_snapshots_unanswered
  on public.gv_respond_contact_snapshots (respond_unanswered_since)
  where respond_unanswered_since is not null;

create index if not exists idx_gv_respond_snapshots_assignee_email
  on public.gv_respond_contact_snapshots (respond_assignee_email)
  where respond_assignee_email is not null;

alter table public.gv_respond_contact_snapshots enable row level security;

grant select on public.gv_respond_contact_snapshots to authenticated;
grant select, insert, update, delete on public.gv_respond_contact_snapshots to service_role;

drop policy if exists "gv_respond_snapshots_select_scope" on public.gv_respond_contact_snapshots;
create policy "gv_respond_snapshots_select_scope"
on public.gv_respond_contact_snapshots
for select
to authenticated
using (
  public.current_profile_role_id() = 'admin'
  or mapped_profile_id = auth.uid()
  or (
    mapped_profile_id is not null
    and public.can_supervise_profile_in_scope(mapped_profile_id, array['ventas'])
  )
);

drop policy if exists "gv_respond_snapshots_write_service" on public.gv_respond_contact_snapshots;
create policy "gv_respond_snapshots_write_service"
on public.gv_respond_contact_snapshots
for all
to service_role
using (true)
with check (true);

commit;
