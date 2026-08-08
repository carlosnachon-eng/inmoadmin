-- Fase 2A Gerencia de Ventas - grants para REST y RLS
-- Estado: NO EJECUTADA.
--
-- Objetivo:
-- Permitir que PostgREST/Supabase REST pueda evaluar RLS y policies sobre las
-- tablas base DEV y tablas GV. Sin estos GRANT, REST responde 403 antes de
-- llegar a evaluar policies.
--
-- NO abre acceso anonimo a datos operativos.
-- NO deshabilita RLS.
-- NO modifica datos.
-- NO ejecutar en Produccion sin revision separada.

begin;

grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.roles,
  public.profiles,
  public.permisos_modulo
to authenticated, service_role;

grant select, insert, update, delete on table
  public.clientes,
  public.propiedades,
  public.citas,
  public.seguimientos_cliente,
  public.cierres,
  public.cierre_pagos,
  public.recibos_apartado,
  public.recibos_abonos,
  public.firmas,
  public.firma_etapas,
  public.firmas_citas,
  public.firmas_usuarios,
  public.cartas_oferta,
  public.leads_respond,
  public.envios,
  public.envios_propiedades
to service_role;

grant select on table
  public.clientes,
  public.propiedades,
  public.citas,
  public.seguimientos_cliente,
  public.cierres,
  public.cierre_pagos,
  public.recibos_apartado,
  public.recibos_abonos,
  public.firmas,
  public.firma_etapas,
  public.firmas_citas,
  public.firmas_usuarios,
  public.cartas_oferta,
  public.leads_respond,
  public.envios,
  public.envios_propiedades
to authenticated;

grant select, insert, update, delete on table
  public.gv_supervision_edges,
  public.gv_advisor_availability,
  public.gv_opportunities,
  public.gv_opportunity_events
to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

commit;
