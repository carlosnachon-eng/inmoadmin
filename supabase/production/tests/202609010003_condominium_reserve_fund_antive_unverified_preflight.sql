-- Captura dinámica tenant-scoped previa/posterior al pase 202609010003.
-- Sólo lectura. La salida no contiene PII y vive únicamente durante la ejecución.

with
genova as (
  select '29ebc26e-b82d-c90c-10a7-1f3761aeca09'::uuid as id
),
components as (
  select
    md5(coalesce((
      select string_agg(md5(to_jsonb(a)::text), '' order by a.id)
      from public.condominium_historical_accounts a
      where a.condominio_id = g.id
    ), '')) as historical_accounts_fp,
    md5(coalesce((
      select string_agg(md5(to_jsonb(p)::text), '' order by p.id)
      from public.condominium_historical_payments p
      where p.condominio_id = g.id
    ), '')) as historical_payments_fp,
    md5(coalesce((
      select string_agg(md5(to_jsonb(r)::text), '' order by r.id)
      from public.condominium_historical_recoveries r
      where r.condominio_id = g.id
    ), '')) as historical_recoveries_fp,
    md5(coalesce((
      select string_agg(md5(to_jsonb(o)::text), '' order by o.name)
      from storage.objects o
      where o.bucket_id = 'condominium-historical-evidence'
        and o.name like g.id::text || '/%'
    ), '')) as historical_evidence_fp,
    md5(coalesce((
      select string_agg(md5(to_jsonb(q)::text), '' order by q.id)
      from public.cuotas_condominio q
      where q.condominio_id = g.id
    ), '')) as current_fees_fp,
    md5(coalesce((
      select string_agg(md5(jsonb_build_object(
        'id', u.id,
        'condominio_id', u.condominio_id,
        'numero', u.numero,
        'piso', u.piso,
        'activo', u.activo,
        'created_at', u.created_at
      )::text), '' order by u.id)
      from public.unidades_condominio u
      where u.condominio_id = g.id
    ), '')) as units_fp,
    md5(coalesce((
      select md5(to_jsonb(c)::text)
      from public.condominium_operation_controls c
      where c.condominio_id = g.id
    ), '')) as operation_controls_fp,
    (select count(*) from public.condominium_historical_recoveries r where r.condominio_id = g.id) as historical_recoveries_count,
    (select coalesce(sum(r.amount), 0) from public.condominium_historical_recoveries r where r.condominio_id = g.id and r.status = 'APLICADO') as historical_recovered_amount,
    (select count(*) from storage.objects o where o.bucket_id = 'condominium-historical-evidence' and o.name like g.id::text || '/%') as historical_evidence_count,
    (select count(*) from public.condominium_reserve_fund_contributions c where c.condominio_id = g.id) as reserve_contributions,
    (select count(*) from public.condominium_reserve_fund_receipts r where r.condominio_id = g.id) as reserve_receipts,
    (select count(*) from storage.objects o where o.bucket_id = 'condominium-reserve-fund-evidence' and o.name like g.id::text || '/%') as reserve_evidence
  from genova g
),
snapshot as (
  select to_jsonb(components) as value from components
)
select jsonb_build_object(
  'scope', 'GENOVA',
  'operational_fingerprint', md5((value - array['reserve_contributions','reserve_receipts','reserve_evidence'])::text),
  'components', value - array['reserve_contributions','reserve_receipts','reserve_evidence'],
  'reserve_fund', jsonb_build_object(
    'contributions', value->'reserve_contributions',
    'receipts', value->'reserve_receipts',
    'evidence', value->'reserve_evidence'
  )
) as condominium_reserve_fund_antive_fingerprint
from snapshot;
