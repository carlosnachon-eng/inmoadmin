-- Ejecutar inmediatamente antes y después del E2E UI/API en la misma ventana de
-- certificación. El consumidor compara ambas filas literalmente. No persiste datos
-- ni expone campos de negocio o PII: sólo conteos y hashes determinísticos.
select
  count(*)::bigint as legacy_ticket_count,
  md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by t.id::text),'')) as legacy_ticket_fingerprint,
  (select count(*) from public.maintenance_tickets where not legacy_record) as v1_ticket_count,
  (select count(*) from public.maintenance_ticket_updates) as v1_update_count,
  (select count(*) from public.maintenance_ticket_evidence) as v1_evidence_count,
  (select count(*) from storage.objects where bucket_id='condominium-incident-evidence') as v1_storage_count
from public.maintenance_tickets t
where t.legacy_record;
