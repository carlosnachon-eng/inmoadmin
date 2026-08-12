-- DEV ONLY - Fase 2A.2-A - casos sinteticos de Condominios.
-- Proyecto autorizado: inmoadmin-dev (hjfwjnejbcpmknvfpdcq).
-- NUNCA ejecutar en Produccion.
-- UUID namespace QA: 2a223000-0000-4000-8000-000000000xxx.
-- Sin nombres, emails, telefonos, direcciones, notas ni documentos reales.

begin;

insert into public.condominios (id, activo)
values
  ('2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000002', false)
on conflict (id) do update set activo = excluded.activo;

insert into public.unidades_condominio (id, condominio_id, activo)
values
  ('2a223000-0000-4000-8000-000000000101', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000102', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000103', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000104', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000105', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000106', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000107', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000108', '2a223000-0000-4000-8000-000000000001', true),
  ('2a223000-0000-4000-8000-000000000109', '2a223000-0000-4000-8000-000000000001', false),
  ('2a223000-0000-4000-8000-000000000110', '2a223000-0000-4000-8000-000000000002', true)
on conflict (id) do update
set condominio_id = excluded.condominio_id,
    activo = excluded.activo;

-- 101: cuota vencida 1-4 dias.
-- 102: moroso reciente.
-- 103: critico por antiguedad.
-- 104: critico por multiples cuotas.
-- 105: comprobante pendiente de aplicar.
-- 106: critico + comprobante, una sola tarjeta.
-- 107: sin cuota del periodo actual.
-- 108: pagada, excluida.
-- 109 y 110: unidad/condominio inactivos, excluidos.
insert into public.cuotas_condominio
  (id, condominio_id, unidad_id, periodo, monto, status, fecha_vencimiento, comprobante_url, created_at)
values
  ('2a223000-0000-4000-8000-000000000201', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000101', to_char(current_date, 'YYYY-MM'), 1000, 'pendiente', current_date - 2, null, now() - interval '3 days'),
  ('2a223000-0000-4000-8000-000000000202', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000102', to_char(current_date, 'YYYY-MM'), 1100, 'atrasado', current_date - 10, null, now() - interval '11 days'),
  ('2a223000-0000-4000-8000-000000000203', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000103', to_char(current_date, 'YYYY-MM'), 1200, 'atrasado', current_date - 35, null, now() - interval '36 days'),
  ('2a223000-0000-4000-8000-000000000204', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000104', to_char(current_date, 'YYYY-MM'), 1300, 'atrasado', current_date - 10, null, now() - interval '11 days'),
  ('2a223000-0000-4000-8000-000000000205', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000104', to_char(current_date - interval '1 month', 'YYYY-MM'), 1400, 'atrasado', current_date - 20, null, now() - interval '21 days'),
  ('2a223000-0000-4000-8000-000000000206', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000105', to_char(current_date, 'YYYY-MM'), 1500, 'pendiente', current_date + 5, 'urn:qa:2a2:receipt:105', now() - interval '1 day'),
  ('2a223000-0000-4000-8000-000000000207', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000106', to_char(current_date, 'YYYY-MM'), 1600, 'atrasado', current_date - 40, 'urn:qa:2a2:receipt:106', now() - interval '41 days'),
  ('2a223000-0000-4000-8000-000000000208', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000106', to_char(current_date - interval '1 month', 'YYYY-MM'), 1700, 'atrasado', current_date - 70, null, now() - interval '71 days'),
  ('2a223000-0000-4000-8000-000000000209', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000108', to_char(current_date, 'YYYY-MM'), 1800, 'pagado', current_date - 2, null, now() - interval '3 days'),
  ('2a223000-0000-4000-8000-000000000210', '2a223000-0000-4000-8000-000000000001', '2a223000-0000-4000-8000-000000000109', to_char(current_date, 'YYYY-MM'), 1900, 'atrasado', current_date - 50, null, now() - interval '51 days'),
  ('2a223000-0000-4000-8000-000000000211', '2a223000-0000-4000-8000-000000000002', '2a223000-0000-4000-8000-000000000110', to_char(current_date, 'YYYY-MM'), 2000, 'atrasado', current_date - 60, null, now() - interval '61 days')
on conflict (id) do nothing;

commit;
