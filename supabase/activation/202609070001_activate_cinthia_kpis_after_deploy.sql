\set ON_ERROR_STOP on
begin;
set local role postgres;

do $$
begin
  if not exists(
    select 1 from public.sales_team_memberships m
    join public.sales_teams t on t.id=m.team_id
    where m.advisor_profile_id='62d8ab6c-1de9-4059-b784-8172c6b444fa'
      and t.code='VENTAS_VERACRUZ' and m.left_at is null
  ) then
    raise exception 'Cinthia no tiene membresía activa en VENTAS_VERACRUZ';
  end if;
  if exists(
    select 1 from public.sales_team_memberships m
    join public.sales_teams t on t.id=m.team_id
    where m.advisor_profile_id='62d8ab6c-1de9-4059-b784-8172c6b444fa'
      and t.code='VENTAS_PUEBLA' and m.left_at is null
  ) then
    raise exception 'Cinthia tiene membresía inesperada en VENTAS_PUEBLA';
  end if;
end $$;

update public.profiles
set participa_kpis=true
where id='62d8ab6c-1de9-4059-b784-8172c6b444fa'
  and active=true and role_id='asesor' and participa_kpis=false;

do $$
begin
  if not exists(select 1 from public.profiles
    where id='62d8ab6c-1de9-4059-b784-8172c6b444fa' and participa_kpis=true) then
    raise exception 'No se pudo activar participa_kpis de Cinthia';
  end if;
end $$;
commit;
