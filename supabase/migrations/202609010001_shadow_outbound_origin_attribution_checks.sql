do $$
declare
  definition text;
begin
  select pg_get_constraintdef(oid) into definition
  from pg_constraint
  where conrelid = 'public.shadow_messages'::regclass
    and conname = 'shadow_messages_direction_check';

  if definition is null
     or position('outbound_ai_inmoadmin' in definition) = 0
     or position('outbound_respond_ai' in definition) = 0
     or position('outbound_unknown' in definition) = 0 then
    raise exception 'Direcciones de atribución outbound incompletas';
  end if;

  if exists (
    select 1 from public.shadow_messages
    where direction not in (
      'inbound', 'outbound', 'outbound_human',
      'outbound_ai_inmoadmin', 'outbound_respond_ai', 'outbound_unknown'
    )
  ) then
    raise exception 'Existe una dirección Shadow fuera del contrato';
  end if;
end $$;
