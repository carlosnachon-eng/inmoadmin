create table if not exists instagram_business_private.thread_contacts (
  connection_id uuid not null references instagram_business_private.connections(id) on delete cascade,
  thread_ref text not null check (thread_ref ~ '^[a-f0-9]{64}$'),
  phone text,
  email text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (connection_id,thread_ref),
  check (phone is null or (char_length(phone) between 7 and 32 and phone !~ '[[:cntrl:]]')),
  check (email is null or (char_length(email) between 5 and 254 and email !~ '[[:cntrl:]]'))
);
alter table instagram_business_private.thread_contacts enable row level security;
revoke all on table instagram_business_private.thread_contacts from public,anon,authenticated,service_role;
grant select,insert,update,delete on table instagram_business_private.thread_contacts to service_role;
create policy thread_contacts_service_read on instagram_business_private.thread_contacts for select to service_role using(true);
create policy thread_contacts_service_insert on instagram_business_private.thread_contacts for insert to service_role with check(true);
create policy thread_contacts_service_update on instagram_business_private.thread_contacts for update to service_role using(true) with check(true);
create policy thread_contacts_service_delete on instagram_business_private.thread_contacts for delete to service_role using(true);

create or replace function public.ig_business_thread_contact_v1(
  p_connection uuid,p_thread text,p_actor uuid,p_op text,p_phone text default null,p_email text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_phone text;v_email text;
begin
 if not instagram_business_private.operator(p_connection,p_actor) then raise exception 'forbidden'; end if;
 if p_thread !~ '^[a-f0-9]{64}$' then raise exception 'bad_thread'; end if;
 if not exists(select 1 from instagram_business_private.events e join instagram_business_private.connections c on c.id=e.connection_id
               where e.connection_id=p_connection and e.thread_ref=p_thread and c.active) then raise exception 'thread_missing'; end if;
 if p_op='get' then
  select phone,email into v_phone,v_email from instagram_business_private.thread_contacts
  where connection_id=p_connection and thread_ref=p_thread;
  return jsonb_build_object('phone',v_phone,'email',v_email);
 elsif p_op='set' then
  v_phone:=nullif(btrim(coalesce(p_phone,'')),'');
  v_email:=nullif(lower(btrim(coalesce(p_email,''))),'');
  if v_phone is not null and (char_length(v_phone)<7 or char_length(v_phone)>32 or v_phone ~ '[[:cntrl:]]') then raise exception 'bad_phone'; end if;
  if v_email is not null and (char_length(v_email)<5 or char_length(v_email)>254 or v_email ~ '[[:cntrl:]]' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'bad_email'; end if;
  if v_phone is null and v_email is null then
   delete from instagram_business_private.thread_contacts where connection_id=p_connection and thread_ref=p_thread;
   return jsonb_build_object('phone',null,'email',null);
  end if;
  insert into instagram_business_private.thread_contacts(connection_id,thread_ref,phone,email,updated_by)
  values(p_connection,p_thread,v_phone,v_email,p_actor)
  on conflict(connection_id,thread_ref) do update set phone=excluded.phone,email=excluded.email,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  return jsonb_build_object('phone',v_phone,'email',v_email);
 else raise exception 'bad_op'; end if;
end $$;
revoke all on function public.ig_business_thread_contact_v1(uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ig_business_thread_contact_v1(uuid,text,uuid,text,text,text) to service_role;
