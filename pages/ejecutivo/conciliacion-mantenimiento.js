import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  ESTADOS_CONCILIACION_MANTENIMIENTO,
  coincideBusquedaMantenimiento,
  textoEvidenciaMantenimiento,
} from '../../lib/ejecutivo/conciliacionMantenimiento';

const fmtMoney = (value) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const fmtDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};

const estadoInfo = (estado) => ESTADOS_CONCILIACION_MANTENIMIENTO[estado] || {
  label: estado || '—',
  color: '#374151',
  bg: '#f3f4f6',
  border: '#d1d5db',
};

const Badge = ({ estado }) => {
  const info = estadoInfo(estado);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 999,
      padding: '5px 10px',
      fontSize: 11,
      fontWeight: 900,
      color: info.color,
      background: info.bg,
      border: `1px solid ${info.border}`,
      whiteSpace: 'nowrap',
    }}>
      {info.label}
    </span>
  );
};

const StatCard = ({ label, value, hint, tone = 'default' }) => {
  const palette = {
    default: ['#fff', '#111827'],
    green: ['#ecfdf5', '#047857'],
    yellow: ['#fffbeb', '#92400e'],
    red: ['#fef2f2', '#b91c1c'],
    gray: ['#f9fafb', '#374151'],
  }[tone] || ['#fff', '#111827'];

  return (
    <div style={{ background: palette[0], border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, minHeight: 108 }}>
      <p style={{ margin: 0, fontSize: 12, color: '#6b7280', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
      <p style={{ margin: '10px 0 0', fontSize: 30, color: palette[1], fontWeight: 950 }}>{value}</p>
      {hint && <p style={{ margin: '5px 0 0', color: '#6b7280', fontSize: 12 }}>{hint}</p>}
    </div>
  );
};

const BoolCell = ({ value }) => (
  <span style={{
    display: 'inline-block',
    minWidth: 42,
    textAlign: 'center',
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 900,
    color: value ? '#047857' : '#6b7280',
    background: value ? '#ecfdf5' : '#f3f4f6',
    border: `1px solid ${value ? '#a7f3d0' : '#e5e7eb'}`,
  }}>
    {value ? 'Sí' : 'No'}
  </span>
);

const th = {
  padding: '12px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 950,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  borderBottom: '1px solid #e5e7eb',
};

const td = {
  padding: '14px 10px',
  borderTop: '1px solid #f3f4f6',
  verticalAlign: 'top',
  fontSize: 13,
  color: '#111827',
};

const tdRight = {
  ...td,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 800,
};

export default function ConciliacionMantenimiento() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [perfil, setPerfil] = useState(null);
  const [data, setData] = useState(null);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('pendientes');
  const [mostrarEvidencia, setMostrarEvidencia] = useState({});

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
  }, [session]);

  const autorizado = useMemo(() => {
    const email = (perfil?.email || session?.user?.email || '').toLowerCase();
    return ['admin', 'direccion'].includes(perfil?.role_id) || email === 'carlos.nachon@emporioinmobiliario.mx';
  }, [perfil, session]);

  const cargarDatos = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: perfilData, error: perfilError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role_id')
        .eq('id', session.user.id)
        .maybeSingle();
      if (perfilError) throw perfilError;

      const email = (perfilData?.email || session.user.email || '').toLowerCase();
      const puedeVer = ['admin', 'direccion'].includes(perfilData?.role_id) || email === 'carlos.nachon@emporioinmobiliario.mx';
      setPerfil({ ...(perfilData || {}), email });
      if (!puedeVer) {
        setData(null);
        setError('No tienes permiso para ver conciliación ejecutiva.');
        return;
      }

      const token = session?.access_token;
      const res = await fetch('/api/ejecutivo/conciliacion-mantenimiento', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const conciliacion = await res.json();
      if (!res.ok || !conciliacion.ok) {
        throw new Error(conciliacion.error || 'No se pudo cargar conciliación de mantenimiento.');
      }

      setData({
        ...conciliacion,
      });
      setLastLoadedAt(conciliacion.generated_at || new Date().toISOString());
    } catch (err) {
      setData(null);
      setError(err.message || 'No se pudo cargar conciliación de mantenimiento.');
    } finally {
      setLoading(false);
    }
  };

  const casosFiltrados = useMemo(() => {
    const casos = data?.casos || [];
    return casos.filter((caso) => {
      if (!coincideBusquedaMantenimiento(caso, busqueda)) return false;
      if (estadoFiltro === 'pendientes') return caso.estado !== 'conciliado';
      if (estadoFiltro === 'todos') return true;
      return caso.estado === estadoFiltro;
    });
  }, [data, busqueda, estadoFiltro]);

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

  const resumen = data?.resumen || {};

  return (
    <div style={{ minHeight: '100vh', background: '#f7f3ed', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#111827' }}>
      <div style={{ maxWidth: 1880, margin: '0 auto', padding: '44px 28px 72px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 28 }}>
          <div>
            <div style={{ display: 'inline-flex', background: '#111827', color: '#fff', borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 950, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
              Centro de Inteligencia · Control Interno
            </div>
            <h1 style={{ margin: 0, fontSize: 44, letterSpacing: -1.5, lineHeight: 1.02 }}>Conciliación de Mantenimiento</h1>
            <p style={{ margin: '14px 0 0', maxWidth: 940, color: '#6b7280', fontSize: 20, lineHeight: 1.28 }}>
              Revisa diferencias entre tickets, cotizaciones, caja y descuentos en liquidación. Modo solo lectura.
            </p>
            <p style={{ margin: '12px 0 0', color: '#9ca3af', fontSize: 14, fontWeight: 700 }}>
              Última actualización: {fmtDateTime(lastLoadedAt)}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/ejecutivo/bi-test" style={{ color: '#991b1b', textDecoration: 'none', fontWeight: 950, fontSize: 16 }}>← Volver a BI test</a>
            <button
              onClick={cargarDatos}
              disabled={loading || !autorizado}
              style={{
                border: 0,
                background: loading ? '#6b7280' : '#111827',
                color: '#fff',
                borderRadius: 14,
                padding: '13px 18px',
                fontSize: 15,
                fontWeight: 950,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 16, padding: '18px 20px', fontWeight: 900, marginBottom: 24 }}>
            {error}
          </div>
        )}

        <section style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 28 }}>Salud de conciliación</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(160px, 1fr))', gap: 14 }}>
            <StatCard label="Inconsistencias activas" value={resumen.inconsistencias_activas || 0} hint={`Diferencia: ${fmtMoney(resumen.diferencia_activa)}`} />
            <StatCard label="Regularizables" value={resumen.regularizable || 0} hint="Evidencia fuerte" tone="green" />
            <StatCard label="Revisión manual" value={resumen.revision_recomendada || 0} hint="Indicios, requiere decisión" tone="yellow" />
            <StatCard label="Sin evidencia" value={resumen.sin_evidencia || 0} hint="No integrar automático" tone="red" />
            <StatCard label="Conciliadas" value={resumen.conciliado || 0} hint="Sin diferencia relevante" tone="green" />
            <StatCard label="Margen estimado" value={fmtMoney(resumen.margen_estimado)} hint="No integrado a BI aún" tone="gray" />
          </div>
        </section>

        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 16, padding: '16px 20px', fontWeight: 800, marginBottom: 24 }}>
          Esta pantalla no modifica datos. No regulariza, no crea movimientos, no toca tickets, no toca caja y no integra mantenimiento al BI consolidado.
        </div>

        <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 28 }}>Casos de conciliación</h2>
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 15 }}>
                Se ocultan conciliados por defecto para mantener la lista accionable.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar ticket, propiedad, inquilino..."
                style={{ width: 360, maxWidth: '100%', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', fontSize: 15, fontWeight: 700 }}
              />
              <select
                value={estadoFiltro}
                onChange={(event) => setEstadoFiltro(event.target.value)}
                style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', fontSize: 15, fontWeight: 800, background: '#fff' }}
              >
                <option value="pendientes">Pendientes</option>
                <option value="todos">Todos</option>
                <option value="conciliado">Conciliados</option>
                <option value="regularizable">Regularizables</option>
                <option value="revision_recomendada">Revisión recomendada</option>
                <option value="sin_evidencia">Sin evidencia</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1780 }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={th}>Ticket</th>
                  <th style={th}>Propiedad</th>
                  <th style={th}>Inquilino / propietario</th>
                  <th style={th}>Paga</th>
                  <th style={th}>Status</th>
                  <th style={th}>Cotización</th>
                  <th style={th}>Costo proveedor</th>
                  <th style={th}>Cobrable</th>
                  <th style={th}>Anticipo</th>
                  <th style={th}>Caja</th>
                  <th style={th}>Liquidación</th>
                  <th style={th}>Margen</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Diagnóstico</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={14} style={{ ...td, textAlign: 'center', color: '#6b7280', padding: 36 }}>Cargando conciliación...</td>
                  </tr>
                )}
                {!loading && casosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={14} style={{ ...td, color: '#047857', fontSize: 18, fontWeight: 950, padding: 26 }}>
                      No hay casos con los filtros actuales.
                    </td>
                  </tr>
                )}
                {!loading && casosFiltrados.map((caso) => {
                  const evidenciaAbierta = Boolean(mostrarEvidencia[caso.id]);
                  return (
                    <tr key={caso.id}>
                      <td style={td}>
                        <strong>#{caso.ticket_id}</strong>
                        <p style={{ margin: '5px 0 0', color: '#9ca3af', fontSize: 12, fontWeight: 800 }}>{caso.evidencia?.ticket?.title || '—'}</p>
                      </td>
                      <td style={{ ...td, minWidth: 170, fontWeight: 900 }}>{caso.propiedad}</td>
                      <td style={{ ...td, minWidth: 190 }}>
                        <strong>{caso.inquilino}</strong>
                        <p style={{ margin: '5px 0 0', color: '#6b7280' }}>{caso.propietario}</p>
                      </td>
                      <td style={td}>{caso.quien_paga}</td>
                      <td style={td}>{caso.status_operativo}</td>
                      <td style={td}>
                        <BoolCell value={caso.cotizacion_aprobada} />
                        {caso.cotizacion_id && <p style={{ margin: '6px 0 0', color: '#9ca3af', fontSize: 12 }}>#{caso.cotizacion_id}</p>}
                      </td>
                      <td style={tdRight}>{fmtMoney(caso.costo_proveedor)}</td>
                      <td style={tdRight}>
                        {fmtMoney(caso.monto_cobrable)}
                        {caso.pendiente_cobro > 0 && <p style={{ margin: '5px 0 0', color: '#b91c1c', fontSize: 12 }}>Pendiente {fmtMoney(caso.pendiente_cobro)}</p>}
                      </td>
                      <td style={tdRight}>
                        {fmtMoney(caso.anticipo_registrado)}
                        <p style={{ margin: '5px 0 0' }}><BoolCell value={caso.anticipo_pagado} /></p>
                      </td>
                      <td style={tdRight}>
                        {caso.movimientos_encontrados} mov.
                        <p style={{ margin: '5px 0 0', color: '#047857', fontSize: 12 }}>Cobro {fmtMoney(caso.cobrado_caja)}</p>
                        <p style={{ margin: '2px 0 0', color: '#b91c1c', fontSize: 12 }}>Proveedor {fmtMoney(caso.pagado_proveedor)}</p>
                      </td>
                      <td style={td}>
                        <BoolCell value={caso.descontado_liquidacion} />
                        {caso.recibo_cobro_id && <p style={{ margin: '6px 0 0', color: '#9ca3af', fontSize: 12 }}>Recibo {String(caso.recibo_cobro_id).slice(0, 8).toUpperCase()}</p>}
                      </td>
                      <td style={tdRight}>{fmtMoney(caso.margen_estimado)}</td>
                      <td style={td}><Badge estado={caso.estado} /></td>
                      <td style={{ ...td, minWidth: 340 }}>
                        <strong>{caso.causa_probable}</strong>
                        <p style={{ margin: '7px 0 0', color: '#6b7280', lineHeight: 1.35 }}>{caso.accion_sugerida}</p>
                        <button
                          onClick={() => setMostrarEvidencia((prev) => ({ ...prev, [caso.id]: !prev[caso.id] }))}
                          style={{ marginTop: 8, border: 0, background: 'transparent', color: '#991b1b', fontSize: 13, fontWeight: 950, cursor: 'pointer', padding: 0 }}
                        >
                          {evidenciaAbierta ? '▾ Ocultar evidencia' : '▸ Ver evidencia'}
                        </button>
                        {evidenciaAbierta && (
                          <pre style={{ margin: '10px 0 0', background: '#111827', color: '#e5e7eb', borderRadius: 10, padding: 12, fontSize: 11, lineHeight: 1.35, maxWidth: 520, overflowX: 'auto' }}>
                            {textoEvidenciaMantenimiento(caso.evidencia)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
