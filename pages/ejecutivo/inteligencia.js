import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmtMoney = (value) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};

const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-MX', { dateStyle: 'medium' });
};

const monthValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const confianzaConfig = {
  calculable: {
    label: 'Alta',
    bg: '#ecfdf5',
    color: '#047857',
    border: '#a7f3d0',
  },
  parcial: {
    label: 'En validación',
    bg: '#fffbeb',
    color: '#92400e',
    border: '#fde68a',
  },
  requiere_conciliacion: {
    label: 'Requiere revisión',
    bg: '#fef2f2',
    color: '#b91c1c',
    border: '#fecaca',
  },
  no_disponible: {
    label: 'No disponible',
    bg: '#f3f4f6',
    color: '#374151',
    border: '#d1d5db',
  },
};

const confianzaInfo = (estado) => confianzaConfig[estado] || confianzaConfig.parcial;

const KpiCard = ({ label, value, hint, tone = 'default' }) => {
  const palette = {
    default: ['#fff', '#111827'],
    green: ['#ecfdf5', '#047857'],
    yellow: ['#fffbeb', '#92400e'],
    red: ['#fef2f2', '#b91c1c'],
    dark: ['#111827', '#fff'],
  }[tone] || ['#fff', '#111827'];

  return (
    <div className="ci-exception-row" style={{
      background: palette[0],
      color: palette[1],
      border: tone === 'dark' ? '1px solid #111827' : '1px solid #e5e7eb',
      borderRadius: 22,
      padding: 22,
      minHeight: 142,
      boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
    }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.72 }}>{label}</p>
      <p style={{ margin: '16px 0 0', fontSize: 34, lineHeight: 1, fontWeight: 950, letterSpacing: -1 }}>{value}</p>
      {hint && <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.35, opacity: 0.72 }}>{hint}</p>}
    </div>
  );
};

const Badge = ({ estado }) => {
  const info = confianzaInfo(estado);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      padding: '7px 11px',
      fontSize: 12,
      fontWeight: 950,
      color: info.color,
      background: info.bg,
      border: `1px solid ${info.border}`,
      whiteSpace: 'nowrap',
    }}>
      {info.label}
    </span>
  );
};

const UnidadCard = ({ unidad }) => (
  <div style={{
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 22,
    padding: 20,
    boxShadow: '0 10px 26px rgba(15, 23, 42, 0.045)',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 18 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 21, letterSpacing: -0.3 }}>{unidad.label}</h3>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.35 }}>{unidad.nota}</p>
      </div>
      <Badge estado={unidad.estado_confianza} />
    </div>

    <div className="ci-grid ci-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
      <Metric label="Generado" value={fmtMoney(unidad.metricas?.generado)} />
      <Metric label="Cobrado" value={fmtMoney(unidad.metricas?.cobrado)} positive />
      <Metric label="Pendiente" value={fmtMoney(unidad.metricas?.pendiente)} warning={Number(unidad.metricas?.pendiente || 0) > 0} />
      <Metric label="Resultado" value={fmtMoney(unidad.metricas?.resultado)} positive={Number(unidad.metricas?.resultado || 0) >= 0} warning={Number(unidad.metricas?.resultado || 0) < 0} />
    </div>
  </div>
);

const CajaVsResultado = ({ diagnostico }) => {
  if (!diagnostico) return null;

  const categorias = diagnostico.categorias || [];
  const flujoNeto = Number(diagnostico.flujo_neto_caja || 0);
  const mayorSalida = categorias
    .filter((categoria) => Number(categoria.salidas || 0) > 0)
    .sort((a, b) => Number(b.salidas || 0) - Number(a.salidas || 0))[0];
  const sinClasificar = categorias.find((categoria) => categoria.key === 'no_clasificado');
  const lectura = flujoNeto < 0
    ? `En este periodo salieron ${fmtMoney(Math.abs(flujoNeto))} más de los que entraron a caja.`
    : flujoNeto > 0
      ? `En este periodo entraron ${fmtMoney(flujoNeto)} más de los que salieron de caja.`
      : 'En este periodo las entradas y salidas de caja quedaron equilibradas.';

  return (
    <section style={{ background: '#111827', color: '#fff', borderRadius: 26, padding: 24, marginBottom: 22, boxShadow: '0 16px 38px rgba(15, 23, 42, 0.16)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <p style={{ margin: '0 0 8px', color: '#93c5fd', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.9 }}>
            Diagnóstico de tesorería
          </p>
          <h2 style={{ margin: 0, fontSize: 28, letterSpacing: -0.7 }}>Movimiento de Caja del Mes</h2>
          <p style={{ margin: '8px 0 0', color: '#cbd5e1', maxWidth: 820, lineHeight: 1.45 }}>
            {diagnostico.nota}
          </p>
        </div>
        <span style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>
          Solo lectura
        </span>
      </div>

      <div className="ci-grid ci-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
        <DarkMetric label="Entradas caja" value={fmtMoney(diagnostico.entradas)} tone="green" />
        <DarkMetric label="Salidas caja" value={fmtMoney(diagnostico.salidas)} tone="red" />
        <DarkMetric label="Movimiento neto del mes" value={fmtMoney(diagnostico.flujo_neto_caja)} tone={flujoNeto >= 0 ? 'green' : 'red'} />
      </div>

      <div style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 16, marginBottom: 18 }}>
        <p style={{ margin: 0, color: '#93c5fd', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.4 }}>Lectura ejecutiva</p>
        <p style={{ margin: '7px 0 0', color: '#fff', fontSize: 18, lineHeight: 1.45, fontWeight: 850 }}>
          {lectura}
          {mayorSalida ? ` La mayor salida fue ${mayorSalida.label.toLowerCase()} por ${fmtMoney(mayorSalida.salidas)}.` : ''}
          {Number(sinClasificar?.salidas || 0) > 0 ? ` Hay ${fmtMoney(sinClasificar.salidas)} en salidas sin clasificación suficiente.` : ''}
        </p>
      </div>

      <div className="ci-grid ci-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Lectura por categoría</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {categorias.map((categoria) => (
                <div key={categoria.key} className="ci-category-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: 12 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 950 }}>{categoria.label}</p>
                  <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 12 }}>
                    {categoria.movimientos} mov. · Entradas {fmtMoney(categoria.entradas)} · Salidas {fmtMoney(categoria.salidas)}
                  </p>
                </div>
                <p style={{ margin: 0, fontWeight: 950, color: Number(categoria.neto || 0) >= 0 ? '#34d399' : '#f87171' }}>
                  {fmtMoney(categoria.neto)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Qué revisar</h3>
          {(diagnostico.alertas || []).length === 0 ? (
            <div style={{ background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 14, padding: 14, color: '#bbf7d0', fontWeight: 900 }}>
              No hay alertas importantes en caja para este periodo.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {diagnostico.alertas.map((alerta, index) => (
                <div key={index} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: 12, color: '#e5e7eb', lineHeight: 1.4 }}>
                  {alerta}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const DarkMetric = ({ label, value, tone = 'default' }) => {
  const color = tone === 'green' ? '#34d399' : tone === 'red' ? '#f87171' : '#fff';
  return (
    <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 18, padding: 15 }}>
      <p style={{ margin: 0, color: '#94a3b8', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
      <p style={{ margin: '8px 0 0', color, fontSize: 22, fontWeight: 950 }}>{value}</p>
    </div>
  );
};

const ProyeccionAnual = ({ proyeccion }) => {
  if (!proyeccion) return null;
  const generadoTotal = proyeccion.generado_total_2026 || {};

  return (
    <section style={{ background: '#172554', color: '#fff', borderRadius: 26, padding: 24, marginBottom: 22, boxShadow: '0 16px 38px rgba(30, 64, 175, 0.18)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <p style={{ margin: '0 0 8px', color: '#bfdbfe', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.9 }}>
            Proyección anual
          </p>
          <h2 style={{ margin: 0, fontSize: 28, letterSpacing: -0.7 }}>
            Rumbo de ingresos {proyeccion.year}
          </h2>
          <p style={{ margin: '8px 0 0', color: '#dbeafe', maxWidth: 850, lineHeight: 1.45 }}>
            {generadoTotal.lectura || proyeccion.lectura}
          </p>
        </div>
        <span style={{ border: '1px solid rgba(255,255,255,0.20)', background: 'rgba(255,255,255,0.10)', borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>
          Corte: {fmtDate(proyeccion.corte)} · {proyeccion.avance_anio_porcentaje}% del año
        </span>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 22, padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, color: '#bfdbfe', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Generado proyectado {proyeccion.year}
            </p>
            <p style={{ margin: '9px 0 0', fontSize: 40, lineHeight: 1, fontWeight: 950, letterSpacing: -1.2 }}>
              {fmtMoney(generadoTotal.total_proyectado)}
            </p>
            <p style={{ margin: '9px 0 0', color: '#dbeafe', maxWidth: 760, fontSize: 13, lineHeight: 1.45, fontWeight: 800 }}>
              Estimación de producción bruta esperada. No representa flujo de caja, cobro ni utilidad.
            </p>
          </div>
          <span style={{ background: 'rgba(255,255,255,0.12)', color: '#dbeafe', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 950 }}>
            {generadoTotal.conteo_comprometidos || 0} operaciones comprometidas
          </span>
        </div>

        <div className="ci-grid ci-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
          <DarkMetric label="Confirmado generado" value={fmtMoney(generadoTotal.confirmado)} tone="green" />
          <DarkMetric label="Comprometido" value={fmtMoney(generadoTotal.comprometido)} />
          <DarkMetric label="Probable por ritmo" value={fmtMoney(generadoTotal.probable)} />
        </div>

        {(generadoTotal.items_comprometidos || []).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 8px', color: '#bfdbfe', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Principales operaciones comprometidas
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(generadoTotal.items_comprometidos || []).slice(0, 4).map((item) => (
                <div key={`${item.fuente}-${item.id}`} className="ci-committed-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: 10 }}>
                  <p style={{ margin: 0, color: '#eff6ff', fontSize: 13, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.folio ? `${item.folio} · ` : ''}{item.concepto}
                  </p>
                  <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 950 }}>{fmtMoney(item.monto)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="ci-grid ci-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
        <DarkMetric label="Cobrado acumulado" value={fmtMoney(proyeccion.cobrado_ytd)} tone="green" />
        <DarkMetric label="Proyección cobrada anual" value={fmtMoney(proyeccion.proyeccion_cobrado_anual)} tone="green" />
        <DarkMetric label="Generado acumulado" value={fmtMoney(proyeccion.generado_ytd)} />
        <DarkMetric label="Pendiente acumulado" value={fmtMoney(proyeccion.pendiente_ytd)} tone={Number(proyeccion.pendiente_ytd || 0) > 0 ? 'red' : 'green'} />
      </div>

      <div className="ci-grid ci-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 16, padding: 14 }}>
          <p style={{ margin: 0, color: '#bfdbfe', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.4 }}>Promedio mensual cobrado</p>
          <p style={{ margin: '7px 0 0', fontSize: 19, fontWeight: 950 }}>{fmtMoney(proyeccion.promedio_mensual_cobrado)}</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 16, padding: 14 }}>
          <p style={{ margin: 0, color: '#bfdbfe', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.4 }}>Resultado proyectado</p>
          <p style={{ margin: '7px 0 0', fontSize: 19, fontWeight: 950 }}>{fmtMoney(proyeccion.proyeccion_resultado_anual)}</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.11)', borderRadius: 16, padding: 14 }}>
          <p style={{ margin: 0, color: '#bfdbfe', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.4 }}>Método</p>
          <p style={{ margin: '7px 0 0', color: '#dbeafe', fontSize: 13, lineHeight: 1.35, fontWeight: 800 }}>{proyeccion.metodo}</p>
        </div>
      </div>
    </section>
  );
};

const Metric = ({ label, value, positive, warning }) => (
  <div style={{ background: '#f9fafb', borderRadius: 16, padding: 14 }}>
    <p style={{ margin: 0, fontSize: 11, color: '#6b7280', fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
    <p style={{
      margin: '8px 0 0',
      fontSize: 19,
      fontWeight: 950,
      color: positive ? '#047857' : warning ? '#b45309' : '#111827',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {value}
    </p>
  </div>
);

const QualityBar = ({ value }) => (
  <div>
    <div style={{ height: 12, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${Math.max(0, Math.min(100, Number(value || 0)))}%`,
        background: Number(value || 0) >= 90 ? '#10b981' : Number(value || 0) >= 75 ? '#f59e0b' : '#ef4444',
        borderRadius: 999,
      }} />
    </div>
    <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 13, fontWeight: 800 }}>{Number(value || 0)}% de confiabilidad general</p>
  </div>
);

const priorityStyle = {
  P0: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', label: 'P0' },
  P1: { bg: '#fffbeb', color: '#92400e', border: '#fde68a', label: 'P1' },
  P2: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', label: 'P2' },
};

const resolutionStyle = {
  criterio_direccion: {
    label: 'Requiere criterio de Dirección',
    short: 'Dirección',
    bg: '#111827',
    color: '#fff',
    border: '#111827',
    accent: '#C8102E',
    empty: 'No hay asuntos que requieran criterio de Dirección.',
  },
  revisar_coordinacion: {
    label: 'Revisar por coordinación',
    short: 'Coordinación',
    bg: '#fffbeb',
    color: '#92400e',
    border: '#fde68a',
    accent: '#f59e0b',
    empty: 'No hay asuntos que requieran supervisión de coordinación.',
  },
  resolver_area: {
    label: 'Resolver por el área',
    short: 'Área',
    bg: '#ecfdf5',
    color: '#047857',
    border: '#a7f3d0',
    accent: '#10b981',
    empty: 'No hay pendientes operativos relevantes por área.',
  },
};

const PriorityBadge = ({ value }) => {
  const info = priorityStyle[value] || priorityStyle.P2;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      padding: '6px 10px',
      minWidth: 42,
      fontSize: 12,
      fontWeight: 950,
      background: info.bg,
      color: info.color,
      border: `1px solid ${info.border}`,
    }}>
      {info.label}
    </span>
  );
};

const ResolutionBadge = ({ value }) => {
  const info = resolutionStyle[value] || resolutionStyle.resolver_area;
  return (
    <span style={{
      display: 'inline-flex',
      borderRadius: 999,
      padding: '6px 10px',
      fontSize: 11,
      fontWeight: 950,
      color: info.color,
      background: info.bg,
      border: `1px solid ${info.border}`,
      whiteSpace: 'nowrap',
    }}>
      {info.short}
    </span>
  );
};

const ImpactChips = ({ impactos = {} }) => {
  const labels = [
    ['dinero', 'Dinero'],
    ['reputacion', 'Reputación'],
    ['tiempo', 'Tiempo'],
    ['oportunidad', 'Oportunidad'],
    ['riesgo', 'Riesgo'],
    ['direccion', 'Dirección'],
  ].filter(([key]) => Number(impactos[key] || 0) > 0)
    .sort((a, b) => Number(impactos[b[0]] || 0) - Number(impactos[a[0]] || 0))
    .slice(0, 3);

  if (!labels.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {labels.map(([key, label]) => (
        <span key={key} style={{ borderRadius: 999, padding: '4px 7px', background: '#f3f4f6', color: '#4b5563', fontSize: 11, fontWeight: 850 }}>
          {label}
        </span>
      ))}
    </div>
  );
};

const ExceptionRow = ({ item, compact = false }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: compact ? 'auto 1fr' : 'auto 1fr auto',
    gap: 14,
    alignItems: 'flex-start',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 15,
    background: '#fff',
  }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-start' }}>
      <PriorityBadge value={item.prioridad || item.nivel} />
      <ResolutionBadge value={item.nivel_resolucion} />
    </div>
    <div>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 950, color: '#111827' }}>{item.titulo}</p>
      <p style={{ margin: '5px 0 0', color: '#374151', fontSize: 13, lineHeight: 1.4 }}><strong>Por qué apareció:</strong> {item.motivo}</p>
      <p style={{ margin: '5px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.4 }}><strong>Riesgo:</strong> {item.riesgo || item.impacto}</p>
      <p style={{ margin: '5px 0 0', color: '#111827', fontSize: 13, lineHeight: 1.4 }}><strong>Acción recomendada:</strong> {item.accion_recomendada || item.recomendacion}</p>
      {!compact && <p style={{ margin: '5px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.4 }}><strong>Por qué:</strong> {item.razon_recomendacion}</p>}
      <ImpactChips impactos={item.impactos} />
      <p style={{ margin: '7px 0 0', color: '#9ca3af', fontSize: 12, fontWeight: 850 }}>
        {item.area} · {item.modulo} · Responsable: {item.responsable}
        {item.origen_regla === 'adn_emporio' ? ' · ADN Emporio' : ' · Regla automática'}
      </p>
    </div>
    {!compact && item.href && (
      <a href={item.href} style={{ justifySelf: 'end', textDecoration: 'none', background: '#111827', color: '#fff', borderRadius: 999, padding: '9px 13px', fontSize: 12, fontWeight: 950, whiteSpace: 'nowrap' }}>
        Abrir →
      </a>
    )}
  </div>
);

const ResolutionColumn = ({ nivel, items = [] }) => {
  const info = resolutionStyle[nivel] || resolutionStyle.resolver_area;
  return (
    <section style={{ background: '#fff', border: `1px solid ${info.border}`, borderTop: `5px solid ${info.accent}`, borderRadius: 24, padding: 18, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: -0.4 }}>{info.label}</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.35 }}>
            {nivel === 'criterio_direccion'
              ? 'Solo lo que puede afectar liquidez, reputación o decisiones comerciales sensibles.'
              : nivel === 'revisar_coordinacion'
                ? 'Asuntos que el área puede resolver, pero conviene que un gerente supervise.'
                : 'Pendientes operativos accionables sin intervención de Dirección.'}
          </p>
        </div>
        <span style={{ background: info.bg, color: info.color, border: `1px solid ${info.border}`, borderRadius: 999, padding: '7px 11px', fontSize: 12, fontWeight: 950 }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#047857', borderRadius: 16, padding: 14, fontWeight: 900, fontSize: 13 }}>
          {info.empty}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item) => <ExceptionRow key={item.id} item={item} compact />)}
        </div>
      )}
    </section>
  );
};

const ExceptionSection = ({ title, subtitle, items = [], empty = 'Sin excepciones relevantes.' }) => (
  <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: 22, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, letterSpacing: -0.5 }}>{title}</h2>
        {subtitle && <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 14, lineHeight: 1.35 }}>{subtitle}</p>}
      </div>
      <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 950 }}>
        {items.length}
      </span>
    </div>
    {items.length === 0 ? (
      <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', borderRadius: 16, padding: 15, fontWeight: 900 }}>
        {empty}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => <ExceptionRow key={item.id} item={item} compact />)}
      </div>
    )}
  </section>
);

export default function CentroInteligencia() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [periodoInput, setPeriodoInput] = useState(monthValue());

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!active) return;
      setSession(currentSession);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, periodoInput]);

  const cargarDatos = async () => {
    setLoading(true);
    setError('');
    try {
      const token = session?.access_token;
      if (!token) throw new Error('Sesión requerida');

      const [year, month] = periodoInput.split('-').map(Number);
      const res = await fetch(`/api/ejecutivo/centro-inteligencia?year=${year}&month=${month}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar Centro de Inteligencia.');
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err.message || 'No se pudo cargar Centro de Inteligencia.');
    } finally {
      setLoading(false);
    }
  };

  const resumen = data?.resumen_general || {};
  const calidad = data?.calidad_informacion || {};
  const unidades = data?.unidades || [];
  const acciones = data?.acciones_pendientes || [];
  const cajaVsResultado = data?.caja_vs_resultado || null;
  const proyeccionAnual = data?.proyeccion_anual || null;
  const excepciones = data?.excepciones || {};
  const atencionInmediata = excepciones?.atencion_inmediata || [];
  const porResolucion = excepciones?.por_resolucion || {};
  const resumenExcepciones = excepciones?.resumen_excepciones || {};

  const fraseEjecutiva = useMemo(() => {
    if (!data) return 'Cargando lectura ejecutiva consolidada.';
    const direccion = Number(resumenExcepciones.criterio_direccion || resumenExcepciones.por_resolucion?.criterio_direccion || 0);
    const coordinacion = Number(resumenExcepciones.revisar_coordinacion || resumenExcepciones.por_resolucion?.revisar_coordinacion || 0);
    const area = Number(resumenExcepciones.resolver_area || resumenExcepciones.por_resolucion?.resolver_area || 0);
    if (direccion) return `Hoy hay ${direccion} asunto${direccion === 1 ? '' : 's'} que sí requiere${direccion === 1 ? '' : 'n'} criterio de Dirección. Coordinación revisa ${coordinacion} y las áreas resuelven ${area}.`;
    if (coordinacion || area) return `No hay asuntos críticos de Dirección. Coordinación debe supervisar ${coordinacion} y las áreas tienen ${area} pendiente${area === 1 ? '' : 's'} operativo${area === 1 ? '' : 's'}.`;
    return 'Todo en orden por ahora. El sistema no detecta excepciones que cambien decisiones relevantes.';
  }, [data, resumenExcepciones]);

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f7f3ed' }}>
        <p style={{ color: '#6b7280', fontWeight: 800 }}>Cargando...</p>
      </div>
    );
  }

  if (!session) {
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f3ed', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#111827' }}>
      <style jsx global>{`
        @media (max-width: 980px) {
          .ci-grid,
          .ci-resolution-grid,
          .ci-grid-2,
          .ci-grid-3,
          .ci-grid-4 {
            grid-template-columns: 1fr !important;
          }

          .ci-exception-row {
            grid-template-columns: 1fr !important;
          }

          .ci-exception-row a {
            justify-self: stretch !important;
            text-align: center !important;
          }

          .ci-category-row,
          .ci-quality-row,
          .ci-committed-row {
            grid-template-columns: 1fr !important;
            align-items: flex-start !important;
          }

          .ci-committed-row p {
            white-space: normal !important;
          }
        }

        @media (max-width: 640px) {
          body {
            overflow-x: hidden;
          }

          .ci-page {
            padding: 22px 14px 46px !important;
          }

          .ci-title {
            font-size: 34px !important;
            letter-spacing: -1px !important;
          }

          .ci-subtitle {
            font-size: 16px !important;
          }

          .ci-header-actions {
            width: 100% !important;
          }

          .ci-header-actions input,
          .ci-header-actions button {
            width: 100% !important;
          }
        }
      `}</style>
      <div className="ci-page" style={{ maxWidth: 1440, margin: '0 auto', padding: '42px 26px 72px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 28 }}>
          <div>
            <div style={{ display: 'inline-flex', background: '#111827', color: '#fff', borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 950, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
              Centro de Inteligencia Empresarial
            </div>
            <h1 className="ci-title" style={{ margin: 0, fontSize: 46, letterSpacing: -1.6, lineHeight: 1.02 }}>¿Qué necesita mi atención hoy?</h1>
            <p className="ci-subtitle" style={{ margin: '14px 0 0', maxWidth: 920, color: '#4b5563', fontSize: 20, lineHeight: 1.35 }}>{fraseEjecutiva}</p>
            <p style={{ margin: '10px 0 0', color: '#9ca3af', fontSize: 14, fontWeight: 800 }}>
              Última actualización: {fmtDateTime(data?.generated_at)}
            </p>
            <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 13, fontWeight: 800 }}>
              V2 MDE: detectar, priorizar, asignar responsable, recomendar acción y escalar solo cuando Dirección agrega valor.
            </p>
          </div>

          <div className="ci-header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="month"
              value={periodoInput}
              onChange={(event) => setPeriodoInput(event.target.value)}
              style={{ border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', padding: '12px 14px', fontSize: 15, fontWeight: 900 }}
            />
            <button
              onClick={cargarDatos}
              disabled={loading}
              style={{ border: 0, background: loading ? '#6b7280' : '#111827', color: '#fff', borderRadius: 14, padding: '13px 18px', fontSize: 15, fontWeight: 950, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
        </header>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 16, padding: '18px 20px', fontWeight: 900, marginBottom: 24 }}>
            {error}
          </div>
        )}

        <section style={{ background: '#111827', color: '#fff', borderRadius: 28, padding: 24, marginBottom: 22, boxShadow: '0 18px 44px rgba(15, 23, 42, 0.20)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <p style={{ margin: '0 0 8px', color: '#c4b5fd', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 1 }}>
                Director de Operaciones Digital
              </p>
              <h2 style={{ margin: 0, fontSize: 31, letterSpacing: -0.8 }}>Filtro operativo del día</h2>
              <p style={{ margin: '8px 0 0', color: '#cbd5e1', maxWidth: 860, lineHeight: 1.45 }}>
                El Centro separa lo que debe resolver el área, lo que debe revisar coordinación y lo que realmente requiere criterio de Dirección.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <DarkMetric label="Dirección" value={resumenExcepciones.criterio_direccion || resumenExcepciones.por_resolucion?.criterio_direccion || 0} tone="red" />
              <DarkMetric label="Coordinación" value={resumenExcepciones.revisar_coordinacion || resumenExcepciones.por_resolucion?.revisar_coordinacion || 0} tone="default" />
              <DarkMetric label="Total excepciones" value={resumenExcepciones.total || 0} tone="green" />
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 16 }}>
            <p style={{ margin: 0, color: '#c4b5fd', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Lectura MDE
            </p>
            <p style={{ margin: '7px 0 0', color: '#fff', fontSize: 18, fontWeight: 850, lineHeight: 1.45 }}>
              {fraseEjecutiva}
            </p>
          </div>
          {(data?.fuentes_excepciones_con_error || []).length > 0 && (
            <p style={{ margin: '12px 0 0', color: '#fcd34d', fontSize: 12, fontWeight: 850 }}>
              Algunas fuentes no pudieron consultarse: {data.fuentes_excepciones_con_error.map((item) => item.fuente).join(', ')}.
            </p>
          )}
        </section>

        <section className="ci-grid ci-resolution-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 16, marginBottom: 28 }}>
          <ResolutionColumn nivel="criterio_direccion" items={porResolucion.criterio_direccion || []} />
          <ResolutionColumn nivel="revisar_coordinacion" items={porResolucion.revisar_coordinacion || []} />
          <ResolutionColumn nivel="resolver_area" items={porResolucion.resolver_area || []} />
        </section>

        {atencionInmediata.length > 0 && (
          <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: 22, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)', marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 25, letterSpacing: -0.5 }}>Top 10 por impacto</h2>
                <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 14 }}>
                  Ordenado por dinero, reputación, tiempo, oportunidad, riesgo y dependencia de Dirección.
                </p>
              </div>
              <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 950 }}>
                {atencionInmediata.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {atencionInmediata.map((item) => <ExceptionRow key={item.id} item={item} />)}
            </div>
          </section>
        )}

        <section className="ci-grid ci-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 28 }}>
          <ExceptionSection
            title="Propiedades que necesitan atención"
            subtitle="Inventario publicado/reservado con señales de bajo desempeño o riesgo operativo."
            items={excepciones.propiedades_atencion || []}
          />
          <ExceptionSection
            title="Operaciones que necesitan atención"
            subtitle="Recibos, firmas, pólizas y partners que pueden detener una operación."
            items={excepciones.operaciones_atencion || []}
          />
          <ExceptionSection
            title="Clientes que necesitan atención"
            subtitle="Citas vencidas, citas próximas y prospectos que pueden enfriarse."
            items={excepciones.clientes_atencion || []}
          />
          <ExceptionSection
            title="Dinero que necesita atención"
            subtitle="Cobros, saldos, cierres y conciliaciones con posible impacto en caja."
            items={excepciones.dinero_atencion || []}
          />
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 16px' }}>
          <div style={{ height: 1, background: '#d1d5db', flex: 1 }} />
          <p style={{ margin: 0, color: '#6b7280', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: 1 }}>
            Salud de la empresa
          </p>
          <div style={{ height: 1, background: '#d1d5db', flex: 1 }} />
        </div>

        <section className="ci-grid ci-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 22 }}>
          <KpiCard label="Total generado" value={fmtMoney(resumen.total_generado)} hint="Cierres + Administración + Póliza + Mantenimiento" />
          <KpiCard label="Total cobrado" value={fmtMoney(resumen.total_cobrado)} hint="Cobros trazables, sin caja no vinculada" tone="green" />
          <KpiCard label="Total pendiente" value={fmtMoney(resumen.total_pendiente)} hint="Por cobrar reconstruido por unidad" tone={Number(resumen.total_pendiente || 0) > 0 ? 'yellow' : 'green'} />
          <KpiCard
            label="Resultado operativo consolidado"
            value={fmtMoney(resumen.resultado_operativo)}
            hint={resumen.resultado_operativo_nota}
            tone="dark"
          />
        </section>

        <ProyeccionAnual proyeccion={proyeccionAnual} />

        <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: 22, marginBottom: 22, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 26, letterSpacing: -0.6 }}>Estado de confianza del consolidado</h2>
              <p style={{ margin: '7px 0 0', color: '#6b7280', fontSize: 15 }}>El indicador mide qué tan lista está la información para decisiones ejecutivas.</p>
            </div>
            <Badge estado={resumen.estado_confianza} />
          </div>
          <div style={{ marginTop: 18 }}>
            <QualityBar value={resumen.confianza_porcentaje} />
          </div>
        </section>

        <section style={{ marginBottom: 22 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 28, letterSpacing: -0.7 }}>Desglose por unidad</h2>
          <div className="ci-grid ci-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {unidades.map((unidad) => <UnidadCard key={unidad.key} unidad={unidad} />)}
          </div>
        </section>

        <CajaVsResultado diagnostico={cajaVsResultado} />

        <section className="ci-grid ci-grid-2" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16 }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: 22, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)' }}>
            <h2 style={{ margin: 0, fontSize: 26, letterSpacing: -0.6 }}>Calidad de información</h2>
            <p style={{ margin: '7px 0 18px', color: '#6b7280', fontSize: 15 }}>Conciliación por unidad antes de tomar decisiones finas.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(calidad.unidades || []).map((unidad) => (
                <div key={unidad.key} className="ci-quality-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12, background: '#f9fafb', borderRadius: 16, padding: 14 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 950 }}>{unidad.label}</p>
                    <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
                      {unidad.conciliados}/{unidad.total || 0} conciliados · {unidad.inconsistencias_activas || 0} pendientes
                    </p>
                  </div>
                  <p style={{ margin: 0, fontWeight: 950, color: unidad.confianza_porcentaje >= 90 ? '#047857' : unidad.confianza_porcentaje >= 75 ? '#92400e' : '#b91c1c' }}>
                    {unidad.confianza_porcentaje}%
                  </p>
                  <Badge estado={unidad.estado_confianza} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, padding: 22, boxShadow: '0 12px 30px rgba(15, 23, 42, 0.05)' }}>
            <h2 style={{ margin: 0, fontSize: 26, letterSpacing: -0.6 }}>Acciones pendientes</h2>
            <p style={{ margin: '7px 0 18px', color: '#6b7280', fontSize: 15 }}>Solo asuntos que requieren atención o seguimiento.</p>
            {acciones.length === 0 ? (
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', borderRadius: 16, padding: 16, fontWeight: 950 }}>
                No hay acciones pendientes relevantes para el periodo.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {acciones.map((item) => (
                  <div key={item.key} style={{ border: '1px solid #e5e7eb', borderRadius: 16, padding: 15 }}>
                    <p style={{ margin: 0, fontWeight: 950 }}>{item.label}</p>
                    <p style={{ margin: '7px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.35 }}>{item.nota}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      {item.inconsistencias_activas > 0 && <Pill color="#b91c1c">{item.inconsistencias_activas} inconsistencias</Pill>}
                      {item.regularizaciones_pendientes > 0 && <Pill color="#047857">{item.regularizaciones_pendientes} regularizables</Pill>}
                      {item.revision_manual > 0 && <Pill color="#92400e">{item.revision_manual} revisión manual</Pill>}
                      {item.sin_evidencia > 0 && <Pill color="#b91c1c">{item.sin_evidencia} sin evidencia</Pill>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const Pill = ({ children, color }) => (
  <span style={{
    display: 'inline-flex',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 12,
    fontWeight: 950,
    background: `${color}14`,
    color,
    border: `1px solid ${color}33`,
  }}>
    {children}
  </span>
);
