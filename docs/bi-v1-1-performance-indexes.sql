-- Centro de Inteligencia V1.1 — índices de rendimiento seguros
-- Ejecutar manualmente en Supabase SQL Editor.
-- No cambia datos ni lógica de negocio.
-- Nota: CREATE INDEX CONCURRENTLY no debe ejecutarse dentro de BEGIN/COMMIT.

-- Cierres
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_cierres_fecha_cierre
  ON public.cierres (fecha_cierre);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_cierre_pagos_fecha
  ON public.cierre_pagos (fecha);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_cierre_pagos_cierre_id
  ON public.cierre_pagos (cierre_id);

-- Administración
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_comisiones_admin_periodo
  ON public.comisiones_admin (periodo);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_comisiones_admin_status_fecha_cobro
  ON public.comisiones_admin (status, fecha_cobro);

-- Póliza Jurídica
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_poliza_caja_fecha
  ON public.poliza_caja (fecha);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_poliza_caja_expediente_id
  ON public.poliza_caja (expediente_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_poliza_caja_solicitud_id
  ON public.poliza_caja (solicitud_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_poliza_expedientes_fecha_firma
  ON public.poliza_expedientes (fecha_firma);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_poliza_expedientes_fecha_inicio
  ON public.poliza_expedientes (fecha_inicio);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_solicitudes_fecha_cobro_investigacion
  ON public.solicitudes_inquilino (fecha_cobro_investigacion);

-- Mantenimiento
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_maintenance_tickets_created_at
  ON public.maintenance_tickets (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_maintenance_tickets_updated_at
  ON public.maintenance_tickets (updated_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_maintenance_tickets_fecha_cobro_propietario
  ON public.maintenance_tickets (fecha_cobro_propietario);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_maintenance_quotes_ticket_id
  ON public.maintenance_quotes (ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_maintenance_quotes_created_at
  ON public.maintenance_quotes (created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_maintenance_quotes_updated_at
  ON public.maintenance_quotes (updated_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_cash_movements_date
  ON public.cash_movements (date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_cash_movements_category_date
  ON public.cash_movements (category, date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_cash_movements_reference
  ON public.cash_movements (reference_type, reference_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_properties_name
  ON public.properties (name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bi_contracts_status_property_name
  ON public.contracts (status, property_name);
