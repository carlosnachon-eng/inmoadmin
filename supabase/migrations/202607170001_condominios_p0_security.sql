begin;

create extension if not exists pgcrypto;

create table if not exists public.condominio_miembros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  condominio_id uuid references public.condominios(id) on delete cascade,
  unidad_id uuid references public.unidades_condominio(id) on delete cascade,
  rol text not null check (rol in (
    'direccion','administrador_general','lider_cuenta','cobranza',
    'mantenimiento','juridico','comite','condomino','residente','solo_lectura'
  )),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  check (condominio_id is not null or rol in ('direccion','administrador_general')),
  check (unidad_id is null or condominio_id is not null)
);

create unique index if not exists condominio_miembros_scope_uidx
  on public.condominio_miembros (
    user_id,
    coalesce(condominio_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(unidad_id, '00000000-0000-0000-0000-000000000000'::uuid),
    rol
  );
create index if not exists condominio_miembros_user_idx
  on public.condominio_miembros(user_id, activo);
create index if not exists condominio_miembros_condominio_idx
  on public.condominio_miembros(condominio_id, user_id, activo);

create or replace function public.condominio_rol_permite(p_rol text, p_accion text)
returns boolean language sql immutable parallel safe as $$
  select case p_accion
    when 'consultar' then p_rol = any(array[
      'direccion','administrador_general','lider_cuenta','cobranza','mantenimiento',
      'juridico','comite','condomino','residente','solo_lectura'
    ])
    when 'crear' then p_rol = any(array['direccion','administrador_general'])
    when 'editar' then p_rol = any(array['direccion','administrador_general','lider_cuenta'])
    when 'importar_unidades' then p_rol = any(array['direccion','administrador_general','lider_cuenta'])
    when 'generar_cuotas' then p_rol = any(array['direccion','administrador_general','lider_cuenta','cobranza'])
    when 'registrar_pago' then p_rol = any(array['direccion','administrador_general','lider_cuenta','cobranza'])
    when 'registrar_gasto' then p_rol = any(array['direccion','administrador_general','lider_cuenta','mantenimiento'])
    when 'autorizar' then p_rol = any(array['direccion','administrador_general','lider_cuenta','comite'])
    when 'reversar_pago' then p_rol = any(array['direccion','administrador_general','lider_cuenta','cobranza'])
    when 'reversar_gasto' then p_rol = any(array['direccion','administrador_general','lider_cuenta'])
    when 'cerrar_periodo' then p_rol = any(array['direccion','administrador_general','lider_cuenta'])
    when 'reabrir_periodo' then p_rol = 'direccion'
    when 'exportar' then p_rol = any(array['direccion','administrador_general','lider_cuenta','juridico','comite'])
    when 'administrar_usuarios' then p_rol = any(array['direccion','administrador_general'])
    when 'subir_documento' then p_rol = any(array[
      'direccion','administrador_general','lider_cuenta','cobranza','mantenimiento',
      'juridico','comite','condomino','residente'
    ])
    when 'enviar_recibo' then p_rol = any(array['direccion','administrador_general','lider_cuenta','cobranza'])
    else false
  end
$$;

create or replace function public.condominio_usuario_puede(
  p_user_id uuid,
  p_condominio_id uuid,
  p_accion text,
  p_unidad_id uuid default null
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.condominio_miembros m
     where m.user_id = p_user_id
       and m.activo
       and (m.condominio_id is null or m.condominio_id = p_condominio_id)
       and public.condominio_rol_permite(m.rol, p_accion)
       and (
         m.rol not in ('condomino','residente')
         or (p_unidad_id is not null and m.unidad_id = p_unidad_id)
       )
  )
$$;

create or replace function public.condominio_usuario_puede_actual(
  p_condominio_id uuid,
  p_accion text,
  p_unidad_id uuid default null
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
     and public.condominio_usuario_puede(auth.uid(), p_condominio_id, p_accion, p_unidad_id)
$$;

revoke all on function public.condominio_usuario_puede(uuid,uuid,text,uuid) from public, anon;
revoke all on function public.condominio_usuario_puede_actual(uuid,text,uuid) from public, anon;
grant execute on function public.condominio_usuario_puede_actual(uuid,text,uuid) to authenticated;

create table if not exists public.condominio_periodos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  periodo text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  estado text not null default 'abierto' check (estado in ('abierto','cerrado')),
  cerrado_at timestamptz,
  cerrado_by uuid references auth.users(id),
  reabierto_at timestamptz,
  reabierto_by uuid references auth.users(id),
  motivo_reapertura text,
  created_at timestamptz not null default now(),
  unique (condominio_id, periodo)
);

create table if not exists public.condominio_pagos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  cuota_id uuid references public.cuotas_condominio(id) on delete restrict,
  periodo text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  monto numeric(14,2) not null,
  fecha_pago date not null,
  metodo text,
  referencia text,
  notas text,
  documento_id uuid,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  reversa_de uuid references public.condominio_pagos(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  check (
    (reversa_de is null and monto > 0)
    or (reversa_de is not null and monto < 0)
  )
);

create table if not exists public.condominio_saldos_iniciales (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete restrict,
  unidad_id uuid not null references public.unidades_condominio(id) on delete restrict,
  fecha_corte date not null,
  monto numeric(14,2) not null,
  motivo text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (condominio_id, unidad_id, fecha_corte)
);

create table if not exists public.condominio_documentos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  unidad_id uuid references public.unidades_condominio(id) on delete cascade,
  categoria text not null check (categoria in (
    'comprobante_pago','recibo','gasto','juridico','operativo','exportacion','importacion'
  )),
  bucket text not null default 'condominios-private'
    check (bucket = 'condominios-private'),
  object_path text not null unique,
  nombre_original text not null,
  mime_type text not null check (mime_type in (
    'application/pdf','image/jpeg','image/png','image/webp','text/csv','application/zip'
  )),
  size_bytes bigint not null check (
    (categoria = 'exportacion' and size_bytes between 1 and 104857600)
    or (categoria <> 'exportacion' and size_bytes between 1 and 10485760)
  ),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  retencion_hasta date,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

alter table public.condominio_pagos
  add constraint condominio_pagos_documento_fk
  foreign key (documento_id) references public.condominio_documentos(id) on delete set null;

create table if not exists public.condominio_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id),
  actor_role text,
  condominio_id uuid references public.condominios(id) on delete set null,
  unidad_id uuid references public.unidades_condominio(id) on delete set null,
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  motivo text,
  request_id text,
  origen text not null default 'api',
  resultado text not null default 'exito',
  ip_hash text,
  antes jsonb,
  despues jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists condominio_audit_tenant_idx
  on public.condominio_audit_log(condominio_id, occurred_at desc);

create table if not exists public.condominio_idempotency (
  actor_id uuid not null references auth.users(id) on delete cascade,
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, condominio_id, idempotency_key)
);

create table if not exists public.condominio_import_batches (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  estado text not null default 'preview' check (estado in ('preview','aplicado','fallido','cancelado')),
  filas jsonb not null,
  errores jsonb not null default '[]'::jsonb,
  backup jsonb,
  hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  applied_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table if not exists public.condominio_exportaciones (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  documento_id uuid references public.condominio_documentos(id) on delete set null,
  estado text not null default 'generando' check (estado in ('generando','lista','fallida')),
  sha256 text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  completed_at timestamptz
);

create table if not exists public.condominio_api_rate_limits (
  rate_key text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (rate_key, window_start)
);

alter table public.gastos_condominio add column if not exists notas text;
alter table public.gastos_condominio add column if not exists documento_id uuid references public.condominio_documentos(id) on delete set null;
alter table public.gastos_condominio add column if not exists created_by uuid references auth.users(id);
alter table public.gastos_condominio add column if not exists reversed_at timestamptz;
alter table public.gastos_condominio add column if not exists reversed_by uuid references auth.users(id);
alter table public.gastos_condominio add column if not exists reversal_reason text;
alter table public.cuotas_condominio add column if not exists created_by uuid references auth.users(id);
alter table public.cuotas_condominio add column if not exists comprobante_documento_id uuid references public.condominio_documentos(id) on delete set null;
alter table public.cuotas_condominio add column if not exists recibo_documento_id uuid references public.condominio_documentos(id) on delete set null;
create unique index if not exists cuotas_condominio_unidad_periodo_uidx
  on public.cuotas_condominio(condominio_id, unidad_id, periodo);
create unique index if not exists unidades_condominio_numero_uidx
  on public.unidades_condominio(condominio_id, numero);

create or replace function public.condominio_assert_actor(
  p_actor uuid, p_condominio uuid, p_accion text, p_unidad uuid default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null or not public.condominio_usuario_puede(p_actor, p_condominio, p_accion, p_unidad) then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
end
$$;

create or replace function public.condominio_assert_periodo_abierto(
  p_condominio uuid, p_periodo text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.condominio_periodos
     where condominio_id = p_condominio and periodo = p_periodo and estado = 'cerrado'
  ) then
    raise exception 'El periodo está cerrado' using errcode = '23514';
  end if;
end
$$;

create or replace function public.condominio_auditar(
  p_actor uuid, p_condominio uuid, p_unidad uuid, p_accion text,
  p_entidad text, p_entidad_id uuid, p_motivo text,
  p_antes jsonb, p_despues jsonb, p_request_id text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_role text;
begin
  select m.rol into v_role
    from public.condominio_miembros m
   where m.user_id=p_actor and m.activo
     and (m.condominio_id is null or m.condominio_id=p_condominio)
   order by case m.rol
     when 'direccion' then 1 when 'administrador_general' then 2
     when 'lider_cuenta' then 3 else 10 end
   limit 1;
  insert into public.condominio_audit_log(
    actor_id, actor_role, condominio_id, unidad_id, accion, entidad, entidad_id,
    motivo, antes, despues, request_id, origen, resultado
  ) values (
    p_actor, v_role, p_condominio, p_unidad, p_accion, p_entidad, p_entidad_id,
    p_motivo, p_antes, p_despues, p_request_id, 'api', 'exito'
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.condominio_generar_cuotas(
  p_actor uuid, p_condominio uuid, p_periodo text, p_vencimiento date,
  p_monto numeric, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  perform public.condominio_assert_actor(p_actor, p_condominio, 'generar_cuotas');
  perform public.condominio_assert_periodo_abierto(p_condominio, p_periodo);
  if p_periodo !~ '^[0-9]{4}-[0-9]{2}$' or p_monto <= 0 then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;

  insert into public.condominio_periodos(condominio_id, periodo)
    values (p_condominio, p_periodo) on conflict do nothing;
  insert into public.cuotas_condominio(
    condominio_id, unidad_id, periodo, monto, status, fecha_vencimiento, created_by
  )
  select p_condominio, u.id, p_periodo, p_monto, 'pendiente', p_vencimiento, p_actor
    from public.unidades_condominio u
   where u.condominio_id = p_condominio and coalesce(u.activo, true)
  on conflict (condominio_id, unidad_id, periodo) do nothing;
  get diagnostics v_count = row_count;
  perform public.condominio_auditar(
    p_actor,p_condominio,null,'generar_cuotas','cuotas_condominio',null,null,
    null,jsonb_build_object('periodo',p_periodo,'creadas',v_count),p_request_id
  );
  return jsonb_build_object('creadas', v_count, 'periodo', p_periodo);
end
$$;

create or replace function public.condominio_crear(
  p_actor uuid, p_nombre text, p_direccion text, p_total_unidades integer,
  p_cuota_mensual numeric, p_honorarios numeric, p_notas text,
  p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_row public.condominios;
begin
  perform public.condominio_assert_actor(p_actor,v_id,'crear');
  if length(trim(p_nombre)) < 3 or p_total_unidades < 1 or p_total_unidades > 5000
     or p_cuota_mensual < 0 or p_honorarios < 0 then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  insert into public.condominios(
    id,nombre,direccion,total_unidades,cuota_mensual,honorarios_emporio,notas,activo
  ) values (
    v_id,left(trim(p_nombre),180),left(trim(p_direccion),300),p_total_unidades,
    p_cuota_mensual,p_honorarios,left(trim(p_notas),1000),true
  ) returning * into v_row;
  insert into public.condominio_miembros(user_id,condominio_id,rol,activo,created_by)
  values (p_actor,v_id,'administrador_general',true,p_actor)
  on conflict do nothing;
  perform public.condominio_auditar(
    p_actor,v_id,null,'crear','condominios',v_id,null,null,to_jsonb(v_row),p_request_id
  );
  return to_jsonb(v_row);
end
$$;

create or replace function public.condominio_upsert_miembro(
  p_actor uuid, p_condominio uuid, p_id uuid, p_user uuid, p_unidad uuid,
  p_rol text, p_activo boolean, p_motivo text, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.condominio_miembros; v_antes jsonb;
begin
  perform public.condominio_assert_actor(p_actor,p_condominio,'administrar_usuarios');
  if p_rol not in (
    'administrador_general','lider_cuenta','cobranza','mantenimiento',
    'juridico','comite','condomino','residente','solo_lectura'
  ) or length(trim(p_motivo)) < 8 then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  if p_rol in ('condomino','residente') and p_unidad is null then
    raise exception 'La unidad es obligatoria' using errcode='22023';
  end if;
  if p_unidad is not null and not exists(
    select 1 from public.unidades_condominio where id=p_unidad and condominio_id=p_condominio
  ) then raise exception 'Unidad no encontrada' using errcode='P0002'; end if;
  if not exists(select 1 from auth.users where id=p_user) then
    raise exception 'Usuario no encontrado' using errcode='P0002';
  end if;

  if p_id is null then
    insert into public.condominio_miembros(
      user_id,condominio_id,unidad_id,rol,activo,created_by
    ) values (p_user,p_condominio,p_unidad,p_rol,p_activo,p_actor)
    returning * into v_row;
  else
    select to_jsonb(m) into v_antes from public.condominio_miembros m
     where id=p_id and condominio_id=p_condominio for update;
    if not found then raise exception 'Membresía no encontrada' using errcode='P0002'; end if;
    update public.condominio_miembros set
      unidad_id=p_unidad,rol=p_rol,activo=p_activo
     where id=p_id returning * into v_row;
  end if;
  perform public.condominio_auditar(
    p_actor,p_condominio,p_unidad,'cambiar_permiso','condominio_miembros',
    v_row.id,p_motivo,v_antes,to_jsonb(v_row),p_request_id
  );
  return to_jsonb(v_row);
end
$$;

create or replace function public.condominio_registrar_pago(
  p_actor uuid, p_condominio uuid, p_unidad uuid, p_cuota uuid,
  p_periodo text, p_monto numeric, p_fecha date, p_metodo text,
  p_referencia text, p_notas text, p_documento uuid, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pago public.condominio_pagos; v_cuota public.cuotas_condominio;
begin
  perform public.condominio_assert_actor(p_actor,p_condominio,'registrar_pago');
  perform public.condominio_assert_periodo_abierto(p_condominio,p_periodo);
  if p_monto <= 0 or p_fecha is null then raise exception 'Datos inválidos' using errcode='22023'; end if;
  select * into v_cuota from public.cuotas_condominio
   where id=p_cuota and condominio_id=p_condominio and unidad_id=p_unidad for update;
  if not found then raise exception 'Cuota no encontrada' using errcode='P0002'; end if;
  if v_cuota.status = 'pagado' then raise exception 'La cuota ya está pagada' using errcode='23505'; end if;
  insert into public.condominio_pagos(
    condominio_id,unidad_id,cuota_id,periodo,monto,fecha_pago,metodo,
    referencia,notas,documento_id,created_by
  ) values (
    p_condominio,p_unidad,p_cuota,p_periodo,p_monto,p_fecha,left(p_metodo,60),
    left(p_referencia,160),left(p_notas,1000),p_documento,p_actor
  ) returning * into v_pago;
  update public.cuotas_condominio set
    status='pagado', fecha_pago=p_fecha
   where id=p_cuota;
  perform public.condominio_auditar(
    p_actor,p_condominio,p_unidad,'registrar_pago','condominio_pagos',v_pago.id,null,
    null,to_jsonb(v_pago),p_request_id
  );
  return to_jsonb(v_pago);
end
$$;

create or replace function public.condominio_registrar_gasto(
  p_actor uuid, p_condominio uuid, p_periodo text, p_concepto text,
  p_categoria text, p_monto numeric, p_fecha date, p_notas text,
  p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_gasto public.gastos_condominio;
begin
  perform public.condominio_assert_actor(p_actor,p_condominio,'registrar_gasto');
  perform public.condominio_assert_periodo_abierto(p_condominio,p_periodo);
  if p_monto <= 0 or length(trim(p_concepto)) < 3 or p_fecha is null then
    raise exception 'Datos inválidos' using errcode='22023';
  end if;
  insert into public.gastos_condominio(
    condominio_id,concepto,categoria,monto,fecha,notas,created_by
  ) values (
    p_condominio,left(trim(p_concepto),200),left(trim(p_categoria),80),
    p_monto,p_fecha,left(p_notas,1000),p_actor
  ) returning * into v_gasto;
  perform public.condominio_auditar(
    p_actor,p_condominio,null,'registrar_gasto','gastos_condominio',v_gasto.id,null,
    null,to_jsonb(v_gasto),p_request_id
  );
  return to_jsonb(v_gasto);
end
$$;

create or replace function public.condominio_reversar(
  p_actor uuid, p_condominio uuid, p_tipo text, p_id uuid,
  p_motivo text, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_antes jsonb; v_despues jsonb; v_unidad uuid; v_periodo text;
begin
  if length(trim(p_motivo)) < 8 then raise exception 'Motivo requerido' using errcode='22023'; end if;
  if p_tipo = 'pago' then
    perform public.condominio_assert_actor(p_actor,p_condominio,'reversar_pago');
    select to_jsonb(p),p.unidad_id,p.periodo into v_antes,v_unidad,v_periodo
      from public.condominio_pagos p
     where p.id=p_id and p.condominio_id=p_condominio and p.reversed_at is null for update;
    if not found then raise exception 'Pago no encontrado' using errcode='P0002'; end if;
    perform public.condominio_assert_periodo_abierto(p_condominio,v_periodo);
    update public.condominio_pagos set
      reversed_at=now(),reversed_by=p_actor,reversal_reason=left(trim(p_motivo),500)
     where id=p_id returning to_jsonb(condominio_pagos) into v_despues;
    update public.cuotas_condominio set status='pendiente',fecha_pago=null
     where id=(v_antes->>'cuota_id')::uuid;
  elsif p_tipo = 'gasto' then
    perform public.condominio_assert_actor(p_actor,p_condominio,'reversar_gasto');
    select to_jsonb(g),to_char(g.fecha,'YYYY-MM') into v_antes,v_periodo
      from public.gastos_condominio g
     where g.id=p_id and g.condominio_id=p_condominio and g.reversed_at is null for update;
    if not found then raise exception 'Gasto no encontrado' using errcode='P0002'; end if;
    perform public.condominio_assert_periodo_abierto(p_condominio,v_periodo);
    update public.gastos_condominio set
      reversed_at=now(),reversed_by=p_actor,reversal_reason=left(trim(p_motivo),500)
     where id=p_id returning to_jsonb(gastos_condominio) into v_despues;
  else
    raise exception 'Tipo inválido' using errcode='22023';
  end if;
  perform public.condominio_auditar(
    p_actor,p_condominio,v_unidad,'reversar_'||p_tipo,
    case when p_tipo='pago' then 'condominio_pagos' else 'gastos_condominio' end,
    p_id,p_motivo,v_antes,v_despues,p_request_id
  );
  return v_despues;
end
$$;

create or replace function public.condominio_registrar_saldo_inicial(
  p_actor uuid, p_condominio uuid, p_unidad uuid, p_fecha date,
  p_monto numeric, p_motivo text, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.condominio_saldos_iniciales;
begin
  perform public.condominio_assert_actor(p_actor,p_condominio,'registrar_pago');
  if length(trim(p_motivo)) < 8 then raise exception 'Motivo requerido' using errcode='22023'; end if;
  if not exists(select 1 from public.unidades_condominio where id=p_unidad and condominio_id=p_condominio) then
    raise exception 'Unidad no encontrada' using errcode='P0002';
  end if;
  insert into public.condominio_saldos_iniciales(
    condominio_id,unidad_id,fecha_corte,monto,motivo,created_by
  ) values (p_condominio,p_unidad,p_fecha,p_monto,left(trim(p_motivo),500),p_actor)
  returning * into v_row;
  perform public.condominio_auditar(
    p_actor,p_condominio,p_unidad,'saldo_inicial','condominio_saldos_iniciales',
    v_row.id,p_motivo,null,to_jsonb(v_row),p_request_id
  );
  return to_jsonb(v_row);
end
$$;

create or replace function public.condominio_cambiar_periodo(
  p_actor uuid, p_condominio uuid, p_periodo text, p_estado text,
  p_motivo text default null, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.condominio_periodos; v_antes jsonb;
begin
  if p_estado='cerrado' then
    perform public.condominio_assert_actor(p_actor,p_condominio,'cerrar_periodo');
  elsif p_estado='abierto' then
    perform public.condominio_assert_actor(p_actor,p_condominio,'reabrir_periodo');
    if length(trim(p_motivo)) < 8 then raise exception 'Motivo requerido' using errcode='22023'; end if;
  else raise exception 'Estado inválido' using errcode='22023'; end if;
  select to_jsonb(p) into v_antes from public.condominio_periodos p
   where condominio_id=p_condominio and periodo=p_periodo for update;
  insert into public.condominio_periodos(
    condominio_id,periodo,estado,cerrado_at,cerrado_by,reabierto_at,reabierto_by,motivo_reapertura
  ) values (
    p_condominio,p_periodo,p_estado,
    case when p_estado='cerrado' then now() end,
    case when p_estado='cerrado' then p_actor end,
    case when p_estado='abierto' then now() end,
    case when p_estado='abierto' then p_actor end,
    case when p_estado='abierto' then left(trim(p_motivo),500) end
  ) on conflict (condominio_id,periodo) do update set
    estado=excluded.estado,cerrado_at=excluded.cerrado_at,cerrado_by=excluded.cerrado_by,
    reabierto_at=excluded.reabierto_at,reabierto_by=excluded.reabierto_by,
    motivo_reapertura=excluded.motivo_reapertura
  returning * into v_row;
  perform public.condominio_auditar(
    p_actor,p_condominio,null,
    case when p_estado='cerrado' then 'cerrar_periodo' else 'reabrir_periodo' end,
    'condominio_periodos',v_row.id,p_motivo,v_antes,to_jsonb(v_row),p_request_id
  );
  return to_jsonb(v_row);
end
$$;

create or replace function public.condominio_aplicar_importacion(
  p_actor uuid, p_batch uuid, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.condominio_import_batches; v_row jsonb; v_count integer := 0;
begin
  select * into v_batch from public.condominio_import_batches where id=p_batch for update;
  if not found or v_batch.estado <> 'preview' or v_batch.expires_at < now() then
    raise exception 'Importación no disponible' using errcode='22023';
  end if;
  perform public.condominio_assert_actor(p_actor,v_batch.condominio_id,'importar_unidades');
  if jsonb_array_length(v_batch.errores) > 0 then raise exception 'La vista previa contiene errores' using errcode='22023'; end if;
  update public.condominio_import_batches set backup=(
    select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb)
      from public.unidades_condominio u where u.condominio_id=v_batch.condominio_id
  ) where id=p_batch;
  for v_row in select value from jsonb_array_elements(v_batch.filas)
  loop
    insert into public.unidades_condominio(
      condominio_id,numero,piso,propietario_nombre,propietario_email,
      propietario_telefono,residente_nombre,residente_email,residente_telefono,
      residente_es_propietario,notas,activo
    ) values (
      v_batch.condominio_id,v_row->>'numero',nullif(v_row->>'piso',''),
      nullif(v_row->>'propietario_nombre',''),nullif(v_row->>'propietario_email',''),
      nullif(v_row->>'propietario_telefono',''),nullif(v_row->>'residente_nombre',''),
      nullif(v_row->>'residente_email',''),nullif(v_row->>'residente_telefono',''),
      coalesce((v_row->>'residente_es_propietario')::boolean,false),
      nullif(v_row->>'notas',''),true
    )
    on conflict (condominio_id,numero) do update set
      piso=excluded.piso,propietario_nombre=excluded.propietario_nombre,
      propietario_email=excluded.propietario_email,
      propietario_telefono=excluded.propietario_telefono,
      residente_nombre=excluded.residente_nombre,residente_email=excluded.residente_email,
      residente_telefono=excluded.residente_telefono,
      residente_es_propietario=excluded.residente_es_propietario,
      notas=excluded.notas,activo=true;
    v_count := v_count + 1;
  end loop;
  update public.condominio_import_batches set estado='aplicado',applied_at=now() where id=p_batch;
  perform public.condominio_auditar(
    p_actor,v_batch.condominio_id,null,'importar_unidades','condominio_import_batches',
    p_batch,null,null,jsonb_build_object('filas',v_count),p_request_id
  );
  return jsonb_build_object('filas_aplicadas',v_count,'batch_id',p_batch);
exception when others then
  raise;
end
$$;

create or replace function public.condominio_consume_rate_limit(
  p_key text, p_window_seconds integer, p_max_hits integer
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_start timestamptz; v_hits integer;
begin
  if p_window_seconds < 1 or p_max_hits < 1 then return false; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.condominio_api_rate_limits(rate_key,window_start,hits)
  values (encode(digest(p_key,'sha256'),'hex'),v_start,1)
  on conflict (rate_key,window_start) do update set hits=condominio_api_rate_limits.hits+1
  returning hits into v_hits;
  delete from public.condominio_api_rate_limits
   where window_start < now() - interval '2 days';
  return v_hits <= p_max_hits;
end
$$;

do $$
declare t text; p record;
begin
  foreach t in array array[
    'condominios','unidades_condominio','cuotas_condominio','gastos_condominio',
    'condominio_miembros','condominio_periodos','condominio_pagos',
    'condominio_saldos_iniciales','condominio_documentos','condominio_audit_log',
    'condominio_idempotency','condominio_import_batches','condominio_exportaciones'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t
    loop execute format('drop policy if exists %I on public.%I',p.policyname,t); end loop;
  end loop;
end
$$;

create policy condominios_select on public.condominios for select to authenticated
using (public.condominio_usuario_puede_actual(id,'consultar'));
create policy unidades_select on public.unidades_condominio for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar',id));
create policy cuotas_select on public.cuotas_condominio for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar',unidad_id));
create policy gastos_select on public.gastos_condominio for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar'));
create policy miembros_select on public.condominio_miembros for select to authenticated
using (
  user_id=auth.uid()
  or (condominio_id is not null and public.condominio_usuario_puede_actual(condominio_id,'administrar_usuarios'))
);
create policy periodos_select on public.condominio_periodos for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar'));
create policy pagos_select on public.condominio_pagos for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar',unidad_id));
create policy saldos_select on public.condominio_saldos_iniciales for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar',unidad_id));
create policy documentos_select on public.condominio_documentos for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'consultar',unidad_id));
create policy auditoria_select on public.condominio_audit_log for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'exportar'));
create policy importaciones_select on public.condominio_import_batches for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'importar_unidades'));
create policy exportaciones_select on public.condominio_exportaciones for select to authenticated
using (public.condominio_usuario_puede_actual(condominio_id,'exportar'));

do $$
declare t text;
begin
  foreach t in array array[
    'condominios','unidades_condominio','cuotas_condominio','gastos_condominio',
    'condominio_miembros','condominio_periodos','condominio_pagos',
    'condominio_saldos_iniciales','condominio_documentos','condominio_audit_log',
    'condominio_idempotency','condominio_import_batches','condominio_exportaciones',
    'condominio_api_rate_limits'
  ] loop
    execute format('revoke all on table public.%I from anon',t);
    execute format('revoke insert,update,delete,truncate,references,trigger on table public.%I from authenticated',t);
  end loop;
end
$$;

grant select on public.condominios,public.unidades_condominio,public.cuotas_condominio,
  public.gastos_condominio,public.condominio_miembros,public.condominio_periodos,
  public.condominio_pagos,public.condominio_saldos_iniciales,public.condominio_documentos,
  public.condominio_audit_log,public.condominio_import_batches,
  public.condominio_exportaciones to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'condominios-private','condominios-private',false,104857600,
  array['application/pdf','image/jpeg','image/png','image/webp','text/csv','application/zip']
)
on conflict (id) do update set
  public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists condominios_private_select on storage.objects;
create policy condominios_private_select on storage.objects for select to authenticated
using (
  bucket_id='condominios-private'
  and exists (
    select 1 from public.condominio_documentos d
     where d.bucket=bucket_id and d.object_path=name
       and public.condominio_usuario_puede_actual(d.condominio_id,'consultar',d.unidad_id)
  )
);

revoke all on function public.condominio_assert_actor(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.condominio_assert_periodo_abierto(uuid,text) from public,anon,authenticated;
revoke all on function public.condominio_auditar(uuid,uuid,uuid,text,text,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.condominio_generar_cuotas(uuid,uuid,text,date,numeric,text) from public,anon,authenticated;
revoke all on function public.condominio_crear(uuid,text,text,integer,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.condominio_upsert_miembro(uuid,uuid,uuid,uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.condominio_registrar_pago(uuid,uuid,uuid,uuid,text,numeric,date,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.condominio_registrar_gasto(uuid,uuid,text,text,text,numeric,date,text,text) from public,anon,authenticated;
revoke all on function public.condominio_reversar(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.condominio_registrar_saldo_inicial(uuid,uuid,uuid,date,numeric,text,text) from public,anon,authenticated;
revoke all on function public.condominio_cambiar_periodo(uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.condominio_aplicar_importacion(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.condominio_consume_rate_limit(text,integer,integer) from public,anon,authenticated;

grant execute on function public.condominio_usuario_puede(uuid,uuid,text,uuid) to service_role;
grant execute on function public.condominio_assert_actor(uuid,uuid,text,uuid) to service_role;
grant execute on function public.condominio_assert_periodo_abierto(uuid,text) to service_role;
grant execute on function public.condominio_auditar(uuid,uuid,uuid,text,text,uuid,text,jsonb,jsonb,text) to service_role;
grant execute on function public.condominio_generar_cuotas(uuid,uuid,text,date,numeric,text) to service_role;
grant execute on function public.condominio_crear(uuid,text,text,integer,numeric,numeric,text,text) to service_role;
grant execute on function public.condominio_upsert_miembro(uuid,uuid,uuid,uuid,uuid,text,boolean,text,text) to service_role;
grant execute on function public.condominio_registrar_pago(uuid,uuid,uuid,uuid,text,numeric,date,text,text,text,uuid,text) to service_role;
grant execute on function public.condominio_registrar_gasto(uuid,uuid,text,text,text,numeric,date,text,text) to service_role;
grant execute on function public.condominio_reversar(uuid,uuid,text,uuid,text,text) to service_role;
grant execute on function public.condominio_registrar_saldo_inicial(uuid,uuid,uuid,date,numeric,text,text) to service_role;
grant execute on function public.condominio_cambiar_periodo(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.condominio_aplicar_importacion(uuid,uuid,text) to service_role;
grant execute on function public.condominio_consume_rate_limit(text,integer,integer) to service_role;
commit;
