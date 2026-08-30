begin transaction read only;
do $$
begin
  if exists(select 1 from public.profiles where id='ffffffff-ffff-4fff-8fff-fffffffff201' or email='antive.synthetic@example.invalid') then
    raise exception 'CHECK: identidad sintética persistida';
  end if;
  if exists(select 1 from public.condominium_access_memberships where principal_user_id='ffffffff-ffff-4fff-8fff-fffffffff201') then
    raise exception 'CHECK: membresía sintética persistida';
  end if;
  if exists(select 1 from public.condominium_provider_preparations where provider_name='Proveedor sintético')
     or exists(select 1 from public.condominium_transition_items where title='Pendiente sintético Antive')
     or exists(select 1 from public.maintenance_tickets where title='Incidencia sintética Antive') then
    raise exception 'CHECK: fixture sintético persistido';
  end if;
end $$;
select 'CONDOMINIUM_TRANSITION_VIEWER_CLEANUP_OK' as result;
rollback;
