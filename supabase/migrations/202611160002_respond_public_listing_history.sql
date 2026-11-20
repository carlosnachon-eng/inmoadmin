begin;

create schema if not exists respond_listing_private;
revoke all on schema respond_listing_private from public, anon, authenticated;

create table respond_listing_private.publication (
  property_id uuid primary key references public.propiedades(id) on delete cascade,
  listing jsonb not null
);
revoke all on table respond_listing_private.publication from public, anon, authenticated;

create function respond_listing_private.record_publication() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into respond_listing_private.publication (property_id, listing)
  values (new.id, jsonb_build_object(
    'public_id', new.public_id, 'keyword', new.marketing_keyword_key,
    'titulo', new.titulo, 'operacion', new.operacion, 'precio', new.precio,
    'moneda', new.moneda, 'tipo', new.tipo, 'recamaras', new.recamaras,
    'banos', new.banos, 'colonia', new.colonia, 'ciudad', new.ciudad))
  on conflict (property_id) do update set listing = excluded.listing;
  return new;
end;
$$;

create trigger respond_record_publication
after insert or update on public.propiedades
for each row when (new.status = 'published')
execute function respond_listing_private.record_publication();

insert into respond_listing_private.publication (property_id, listing)
select id, jsonb_build_object(
  'public_id', public_id, 'keyword', marketing_keyword_key, 'titulo', titulo,
  'operacion', operacion, 'precio', precio, 'moneda', moneda, 'tipo', tipo,
  'recamaras', recamaras, 'banos', banos, 'colonia', colonia, 'ciudad', ciudad)
from public.propiedades where status = 'published'
on conflict (property_id) do nothing;

create function public.respond_inventory_exact_listing(
  p_capability text, p_generation bigint, p_token_sha256 text,
  p_keyword text, p_reference text, p_operation text, p_city text,
  p_type text, p_max_price numeric, p_currency text, p_zone_terms text[]
) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare
  gate jsonb;
begin
  if p_token_sha256 is null then
    gate := public.respond_inventory_gate(p_capability, 'check', p_generation);
  else
    gate := public.respond_inventory_gate_v2(p_capability, 'check', p_generation, p_token_sha256);
  end if;
  if p_generation is null or gate->>'status' is distinct from 'allowed'
     or gate->>'generation' is distinct from p_generation::text then
    return jsonb_build_object('status', 'denied');
  end if;

  if (p_keyword is null) = (p_reference is null)
     or coalesce(array_length(p_zone_terms, 1), 0) > 4
     or exists (select 1 from unnest(p_zone_terms) term where term !~ '^[[:alpha:]]{3,80}$') then
    return jsonb_build_object('status', 'invalid');
  end if;

  return jsonb_build_object('status', 'ok', 'listings', (
    select coalesce(jsonb_agg(match.listing), '[]'::jsonb)
    from (
      select h.listing - 'keyword' - 'colonia' || jsonb_build_object('status', p.status) as listing
      from respond_listing_private.publication h
      join public.propiedades p on p.id = h.property_id
      where (p.status in ('published', 'reserved')
          or (p.status = 'sold' and p.operacion = 'sale')
          or (p.status = 'leased' and p.operacion = 'rental'))
        and p.operacion = h.listing->>'operacion'
        and ((p_keyword is not null and h.listing->>'keyword' = p_keyword)
          or (p_reference is not null and lower(h.listing->>'public_id') = lower(p_reference)))
        and (p_operation is null or h.listing->>'operacion' = p_operation)
        and (p_city is null or (h.listing->>'ciudad') ilike '%' || p_city || '%')
        and (p_type is null or lower(h.listing->>'tipo') = lower(p_type))
        and (p_max_price is null or (h.listing->>'moneda' = p_currency
          and (h.listing->>'precio')::numeric between 0.01 and p_max_price))
        and not exists (
          select 1 from unnest(p_zone_terms) term
          where not (concat_ws(' ', h.listing->>'colonia', h.listing->>'ciudad', h.listing->>'titulo')
            ilike '%' || term || '%'))
      limit 2
    ) match
  ));
end;
$$;

revoke all on function public.respond_inventory_exact_listing(text,bigint,text,text,text,text,text,text,numeric,text,text[])
  from public, anon, authenticated;
grant execute on function public.respond_inventory_exact_listing(text,bigint,text,text,text,text,text,text,numeric,text,text[])
  to anon;
notify pgrst, 'reload schema';
commit;
