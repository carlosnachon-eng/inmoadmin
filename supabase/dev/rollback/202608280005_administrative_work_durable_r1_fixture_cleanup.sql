-- DEV fixture cleanup only; never run in Production.
begin;
delete from public.administrative_work_history where idempotency_key like 'dev:admin-work-r1:%';
delete from public.administrative_work_evidence where evidence_key like 'dev:admin-work-r1:%';
delete from public.administrative_work_source_links where link_key like 'dev:admin-work-r1:%';
delete from public.administrative_work_items where dedupe_key like 'dev:admin-work-r1:%';
commit;
