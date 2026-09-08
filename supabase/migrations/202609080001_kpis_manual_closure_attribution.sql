begin;
set local role postgres;

create or replace function public.resolve_commercial_attribution(
  p_event_type text,
  p_event_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_type text := upper(trim(coalesce(p_event_type,'')));
  v_property_id uuid;
  v_plaza_id uuid;
  v_advisor_id uuid;
  v_occurred_at timestamptz;
  v_team_id uuid;
  v_responsible_id uuid;
  v_membership_count integer;
  v_responsibility_count integer;
  v_existing_id uuid;
  v_seller_name text;
  v_seller_key text;
  v_advisor_match_count integer;
begin
  if v_type not in ('CITA','APARTADO','CIERRE') then
    return jsonb_build_object('resolution','ERROR','reason','UNSUPPORTED_EVENT_TYPE');
  end if;

  if v_type='CITA' then
    select c.propiedad_id,c.asesor_id,c.fecha_hora,a.id,null::text
      into v_property_id,v_advisor_id,v_occurred_at,v_existing_id,v_seller_name
    from public.citas c
    left join public.commercial_attributions a on a.cita_id=c.id
    where c.id=p_event_key::uuid;
  elsif v_type='APARTADO' then
    select r.propiedad_id,r.asesor_id,coalesce(r.created_at,r.fecha::timestamptz),a.id,null::text
      into v_property_id,v_advisor_id,v_occurred_at,v_existing_id,v_seller_name
    from public.recibos_apartado r
    left join public.commercial_attributions a on a.recibo_apartado_id=r.id
    where r.id=p_event_key::uuid;
  else
    select c.propiedad_id,coalesce(c.advisor_profile_id,r.asesor_id),
           coalesce(c.fecha_cierre::timestamptz,c.created_at),a.id,c.vendedor
      into v_property_id,v_advisor_id,v_occurred_at,v_existing_id,v_seller_name
    from public.cierres c
    left join public.recibos_apartado r on r.id=c.recibo_id
    left join public.commercial_attributions a on a.cierre_id=c.id
    where c.id=p_event_key::bigint;
  end if;

  if not found then
    return jsonb_build_object('resolution','ERROR','reason','EVENT_NOT_FOUND');
  end if;
  if v_existing_id is not null then
    return jsonb_build_object('resolution','ALREADY_ATTRIBUTED','reason','ATTRIBUTION_EXISTS','attribution_id',v_existing_id);
  end if;
  if v_occurred_at is null then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_EVENT_DATE');
  end if;
  if v_occurred_at::date < date '2026-09-01' then
    return jsonb_build_object('resolution','EXCLUDED','reason','BEFORE_EFFECTIVE_DATE','occurred_at',v_occurred_at);
  end if;

  if v_type='CIERRE' and v_advisor_id is null and nullif(trim(coalesce(v_seller_name,'')),'') is not null then
    v_seller_key := lower(translate(trim(v_seller_name), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN'));

    select count(*),(array_agg(p.id order by p.full_name nulls last,p.email))[1]
      into v_advisor_match_count,v_advisor_id
    from public.profiles p
    where p.active is true
      and p.role_id in ('asesor','gerente_ventas')
      and (
        lower(translate(trim(coalesce(p.full_name,'')), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN')) = v_seller_key
        or lower(translate(split_part(trim(coalesce(p.full_name,'')), ' ', 1), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN')) = v_seller_key
      );

    if coalesce(v_advisor_match_count,0) = 0 then
      return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_ADVISOR','seller',v_seller_name);
    elsif v_advisor_match_count > 1 then
      return jsonb_build_object('resolution','AMBIGUOUS','reason','MULTIPLE_SELLER_PROFILE_MATCHES','seller',v_seller_name,'count',v_advisor_match_count);
    end if;
  end if;

  if v_property_id is not null then
    select plaza_id into v_plaza_id from public.propiedades where id=v_property_id;
    if v_plaza_id is null then
      return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_PROPERTY_PLAZA','property_id',v_property_id);
    end if;
  elsif v_type <> 'CIERRE' then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_PROPERTY');
  end if;

  if v_advisor_id is null then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_ADVISOR','property_id',v_property_id,'plaza_id',v_plaza_id);
  end if;

  if v_property_id is null then
    select count(*),(array_agg(m.team_id order by m.joined_at desc))[1]
      into v_membership_count,v_team_id
    from public.sales_team_memberships m
    where m.advisor_profile_id=v_advisor_id
      and m.joined_at<=v_occurred_at::date
      and (m.left_at is null or m.left_at>=v_occurred_at::date);
  else
    select count(*),(array_agg(team_id order by joined_at desc))[1]
      into v_membership_count,v_team_id
    from public.sales_team_memberships
    where advisor_profile_id=v_advisor_id
      and joined_at<=v_occurred_at::date
      and (left_at is null or left_at>=v_occurred_at::date);
  end if;

  if v_membership_count=0 then
    select count(*),(array_agg(r.team_id order by r.starts_at desc))[1]
      into v_membership_count,v_team_id
    from public.sales_team_responsibilities r
    join public.sales_teams t on t.id=r.team_id and (v_plaza_id is null or t.plaza_id=v_plaza_id)
    join public.profiles p on p.id=r.responsible_profile_id and p.role_id='gerente_ventas'
    where r.responsible_profile_id=v_advisor_id
      and r.starts_at<=v_occurred_at::date
      and (r.ends_at is null or r.ends_at>=v_occurred_at::date);
  end if;
  if v_membership_count=0 then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_TEAM_MEMBERSHIP','advisor_profile_id',v_advisor_id);
  elsif v_membership_count>1 then
    return jsonb_build_object('resolution','AMBIGUOUS','reason','MULTIPLE_TEAM_MEMBERSHIPS','advisor_profile_id',v_advisor_id,'count',v_membership_count);
  end if;

  if v_property_id is not null then
    if not exists(select 1 from public.sales_teams where id=v_team_id and plaza_id=v_plaza_id) then
      return jsonb_build_object('resolution','INCOMPLETE','reason','TEAM_PLAZA_MISMATCH','team_id',v_team_id,'plaza_id',v_plaza_id);
    end if;
  else
    select t.plaza_id into v_plaza_id from public.sales_teams t where t.id=v_team_id;
    if v_plaza_id is null then
      return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_TEAM_PLAZA','team_id',v_team_id);
    end if;
  end if;

  select count(*),(array_agg(responsible_profile_id order by starts_at desc))[1]
    into v_responsibility_count,v_responsible_id
  from public.sales_team_responsibilities
  where team_id=v_team_id
    and starts_at<=v_occurred_at::date
    and (ends_at is null or ends_at>=v_occurred_at::date);
  if v_responsibility_count=0 then
    return jsonb_build_object('resolution','INCOMPLETE','reason','MISSING_TEAM_RESPONSIBLE','team_id',v_team_id);
  elsif v_responsibility_count>1 then
    return jsonb_build_object('resolution','AMBIGUOUS','reason','MULTIPLE_TEAM_RESPONSIBLES','team_id',v_team_id,'count',v_responsibility_count);
  end if;

  return jsonb_build_object(
    'resolution','ATTRIBUTABLE','reason',
    case when v_type='CIERRE' and v_property_id is null then 'SELLER_TEAM_FALLBACK' else 'STRONG_STRUCTURED_EVIDENCE' end,
    'property_id',v_property_id,'plaza_id',v_plaza_id,'team_id',v_team_id,
    'advisor_profile_id',v_advisor_id,'responsible_profile_id',v_responsible_id,
    'occurred_at',v_occurred_at
  );
exception when invalid_text_representation then
  return jsonb_build_object('resolution','ERROR','reason','INVALID_EVENT_KEY');
when others then
  return jsonb_build_object('resolution','ERROR','reason','RESOLUTION_EXCEPTION','error',sqlerrm);
end;
$$;

drop trigger if exists trg_commercial_attribution_cierres on public.cierres;
create trigger trg_commercial_attribution_cierres
after insert or update of propiedad_id,advisor_profile_id,recibo_id,fecha_cierre,vendedor
on public.cierres
for each row execute function public.commercial_attribution_source_trigger();

commit;
