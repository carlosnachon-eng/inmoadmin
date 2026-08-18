begin;

create table public.administrative_case_controls (
  context_key text primary key,
  corrected_bucket text null check (corrected_bucket is null or corrected_bucket in ('critico','vencido','para_hoy','requiere_autorizacion','esperando_tercero','proximo')),
  corrected_priority text null check (corrected_priority is null or corrected_priority in ('P0','P1','P2')),
  responsible_profile_id uuid null references public.profiles(id) on delete restrict,
  resolution_status text not null default 'open' check (resolution_status in ('open','resolved')),
  automation_paused boolean not null default false,
  manual_control boolean not null default false,
  requires_authorization boolean not null default false,
  autonomy_mode text not null default 'manual' check (autonomy_mode in ('manual','supervisado','automatico')),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint administrative_case_controls_context_key_check check (length(btrim(context_key)) between 8 and 500)
);

create table public.administrative_case_actions (
  id uuid primary key default gen_random_uuid(),
  context_key text not null,
  actor_type text not null check (actor_type in ('system','ai','human')),
  actor_profile_id uuid null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in ('classification_corrected','priority_corrected','responsible_reassigned','resolved','reopened','automation_paused','automation_resumed','manual_control_taken','manual_control_released','authorization_required','authorization_cleared','note_added')),
  previous_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  notes text null check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  constraint administrative_case_actions_actor_check check (
    (actor_type = 'human' and actor_profile_id is not null)
    or (actor_type in ('system','ai') and actor_profile_id is null)
  ),
  constraint administrative_case_actions_context_key_check check (length(btrim(context_key)) between 8 and 500)
);

create index administrative_case_actions_context_created_idx
  on public.administrative_case_actions (context_key, created_at desc);

alter table public.administrative_case_controls enable row level security;
alter table public.administrative_case_actions enable row level security;
revoke all on public.administrative_case_controls from public, anon, authenticated;
revoke all on public.administrative_case_actions from public, anon, authenticated;
grant select on public.administrative_case_controls to authenticated;
grant select on public.administrative_case_actions to authenticated;
grant all privileges on public.administrative_case_controls to service_role;
grant all privileges on public.administrative_case_actions to service_role;

create policy administrative_case_controls_select_operations
on public.administrative_case_controls for select to authenticated
using (public.current_profile_role_id() in ('admin','coord_operaciones'));

create policy administrative_case_actions_select_operations
on public.administrative_case_actions for select to authenticated
using (public.current_profile_role_id() in ('admin','coord_operaciones'));

-- Escritura sólo por RPC validada. Las capacidades financieras/jurídicas quedan
-- deliberadamente fuera de action_type. El modelo soporta automatico a futuro,
-- pero esta RPC no permite activarlo y todos los casos nacen en manual.
create or replace function public.supervise_administrative_case(
  p_context_key text,
  p_action_type text,
  p_value jsonb default '{}'::jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_old public.administrative_case_controls%rowtype;
  v_new public.administrative_case_controls%rowtype;
begin
  select role_id into v_role from public.profiles where id = v_actor and active = true;
  if v_actor is null or v_role not in ('admin','coord_operaciones') then
    raise exception using errcode = '42501', message = 'Supervision no autorizada.';
  end if;
  if length(btrim(coalesce(p_context_key,''))) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'Contexto invalido.';
  end if;
  if p_action_type not in ('classification_corrected','priority_corrected','responsible_reassigned','resolved','reopened','automation_paused','automation_resumed','manual_control_taken','manual_control_released','authorization_required','authorization_cleared','note_added') then
    raise exception using errcode = '22023', message = 'Accion no permitida.';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = '22023', message = 'Valor invalido.';
  end if;

  insert into public.administrative_case_controls (context_key, updated_by)
  values (btrim(p_context_key), v_actor)
  on conflict (context_key) do nothing;
  select * into v_old from public.administrative_case_controls where context_key = btrim(p_context_key) for update;

  update public.administrative_case_controls set
    corrected_bucket = case when p_action_type = 'classification_corrected' then nullif(p_value->>'bucket','') else corrected_bucket end,
    corrected_priority = case when p_action_type = 'priority_corrected' then nullif(p_value->>'priority','') else corrected_priority end,
    responsible_profile_id = case when p_action_type = 'responsible_reassigned' then nullif(p_value->>'profileId','')::uuid else responsible_profile_id end,
    resolution_status = case when p_action_type = 'resolved' then 'resolved' when p_action_type = 'reopened' then 'open' else resolution_status end,
    automation_paused = case when p_action_type = 'automation_paused' then true when p_action_type = 'automation_resumed' then false else automation_paused end,
    manual_control = case when p_action_type = 'manual_control_taken' then true when p_action_type = 'manual_control_released' then false else manual_control end,
    requires_authorization = case when p_action_type = 'authorization_required' then true when p_action_type = 'authorization_cleared' then false else requires_authorization end,
    updated_by = v_actor,
    updated_at = now()
  where context_key = btrim(p_context_key)
  returning * into v_new;

  insert into public.administrative_case_actions(context_key, actor_type, actor_profile_id, action_type, previous_value, new_value, notes)
  values (btrim(p_context_key), 'human', v_actor, p_action_type, to_jsonb(v_old), to_jsonb(v_new), nullif(left(btrim(coalesce(p_notes,'')),1000),''));
  return jsonb_build_object('control', to_jsonb(v_new));
end;
$$;

revoke all on function public.supervise_administrative_case(text,text,jsonb,text) from public, anon;
grant execute on function public.supervise_administrative_case(text,text,jsonb,text) to authenticated;
grant execute on function public.supervise_administrative_case(text,text,jsonb,text) to service_role;

commit;
