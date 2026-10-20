-- Read-only DEV cleanup and ACL evidence; never run fixtures in Production.
select jsonb_build_object(
 'fixture_cierres',(select count(*) from public.cierres where id between -251999 and -251900),
 'fixture_audits',(select count(*) from cierre_audit_private.cancelaciones where cierre_id between -251999 and -251900),
 'fixture_payments',(select count(*) from public.cierre_pagos where cierre_id between -251999 and -251900),
 'fixture_attributions',(select count(*) from public.commercial_attributions where cierre_id between -251999 and -251900),
 'fixture_attempts',(select count(*) from public.commercial_attribution_attempts where event_key in('-251943','-251950','-251951','-251960','-251961','-251962','-251963','-251970')),
 'payments_rls',(select relrowsecurity from pg_class where oid='public.cierre_pagos'::regclass),
 'anon_payments_select',has_table_privilege('anon','public.cierre_pagos','select'),
 'anon_cierres_truncate',has_table_privilege('anon','public.cierres','truncate'),
 'authenticated_cierres_truncate',has_table_privilege('authenticated','public.cierres','truncate'),
 'authenticated_payments_truncate',has_table_privilege('authenticated','public.cierre_pagos','truncate'),
 'anon_cancel_rpc',has_function_privilege('anon','public.cancelar_cierre(bigint,text)','execute'),
 'authenticated_audit_insert',has_table_privilege('authenticated','cierre_audit_private.cancelaciones','insert'),
 'audit_rls',(select relrowsecurity from pg_class where oid='cierre_audit_private.cancelaciones'::regclass),
 'migration_history',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations where name in ('cierre_cancelacion_auditada','cierre_cancelacion_preservar_movimientos','cierre_cancelacion_serializar_origen','cierre_pagos_autorizacion_activa','cierre_historial_privilegios'))
) evidence;
