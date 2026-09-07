begin;
set local role postgres;
drop trigger if exists trg_commercial_attribution_citas on public.citas;
drop trigger if exists trg_commercial_attribution_apartados on public.recibos_apartado;
drop trigger if exists trg_commercial_attribution_cierres on public.cierres;
drop trigger if exists trg_commercial_attributions_immutable on public.commercial_attributions;
delete from public.commercial_attributions where source like 'fase2:auto:%';
update public.profiles
set participa_kpis=false
where id='62d8ab6c-1de9-4059-b784-8172c6b444fa' and participa_kpis is distinct from false;
drop view if exists public.v_sales_team_directory;
drop view if exists public.v_commercial_kpi_events;
drop function if exists public.get_sales_kpis_by_scope(date,date,text,text);
drop function if exists public.get_sales_kpi_events_by_scope(date,date,text);
drop function if exists public.report_commercial_attribution_backfill(date,date);
drop function if exists public.commercial_attribution_source_trigger();
drop function if exists public.attribute_commercial_event(text,text,uuid);
drop function if exists public.resolve_commercial_attribution(text,text);
drop function if exists public.prevent_commercial_attribution_mutation();
alter table public.kpis_diarios drop column if exists advisor_profile_id;
drop table if exists public.commercial_attribution_attempts;
commit;
