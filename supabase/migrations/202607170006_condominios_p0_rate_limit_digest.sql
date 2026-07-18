begin;

create or replace function public.condominio_consume_rate_limit(
  p_key text, p_window_seconds integer, p_max_hits integer
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_start timestamptz; v_hits integer;
begin
  if p_window_seconds < 1 or p_max_hits < 1 then return false; end if;
  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  insert into public.condominio_api_rate_limits(rate_key,window_start,hits)
  values (
    encode(
      extensions.digest(convert_to(p_key,'UTF8'),'sha256'::text),
      'hex'
    ),
    v_start,
    1
  )
  on conflict (rate_key,window_start) do update
    set hits=condominio_api_rate_limits.hits+1
  returning hits into v_hits;
  delete from public.condominio_api_rate_limits
   where window_start < now() - interval '2 days';
  return v_hits <= p_max_hits;
end
$$;

revoke all on function public.condominio_consume_rate_limit(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.condominio_consume_rate_limit(text,integer,integer)
  to service_role;

commit;
