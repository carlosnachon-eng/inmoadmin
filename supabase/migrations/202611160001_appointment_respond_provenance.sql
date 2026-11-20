begin;

alter table public.citas
  add column source_opportunity_id uuid,
  add column respond_contact_id text,
  add column respond_conversation_id text;

-- Capture a snapshot of the source visible to the current user under opportunity RLS.
-- An existing appointment keeps its source through rescheduling and status changes.
create function public.capture_cita_respond_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  opportunity public.gv_opportunities%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.source_opportunity_id is distinct from old.source_opportunity_id
      or new.respond_contact_id is distinct from old.respond_contact_id
      or new.respond_conversation_id is distinct from old.respond_conversation_id
      or (old.source_opportunity_id is not null and new.cliente_id is distinct from old.cliente_id)
    then
      raise exception 'No se puede modificar el origen de una cita' using errcode = '23514';
    end if;
    return new;
  end if;

  new.respond_contact_id := null;
  new.respond_conversation_id := null;

  if new.source_opportunity_id is not null then
    select * into opportunity from public.gv_opportunities
    where id = new.source_opportunity_id and cliente_id = new.cliente_id
      and asesor_id = new.asesor_id and nullif(btrim(respond_contact_id), '') is not null;
    if not found then
      raise exception 'La oportunidad de Respond.io no coincide con el cliente y asesor de la cita'
        using errcode = '23514';
    end if;
    new.respond_contact_id := opportunity.respond_contact_id;
    new.respond_conversation_id := nullif(btrim(opportunity.respond_conversation_id), '');
  end if;
  return new;
end;
$$;

create trigger capture_cita_respond_origin
before insert or update on public.citas
for each row execute function public.capture_cita_respond_origin();

commit;
