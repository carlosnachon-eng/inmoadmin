import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  ESTADOS_CONCILIACION_CIERRES,
  clasificarConciliacionCierre,
  construirResumenConciliacion,
  redondearMoneda,
  sumarMontos,
} from '../../lib/ejecutivo/conciliacionCierres';

const fmtMoney = (value) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};

const estadoInfo = (estado) => ESTADOS_CONCILIACION_CIERRES[estado] || {
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
    gray: ['#f3f4f6', '#374151'],
  }[tone] || ['#fff', '#111827'];

  return (
    <div style={{
      background: palette[0],
      border: '1px solid #e5e7eb',
      borderRadius: 16,
      padding: 16,
      minHeight: 112,
    }}>
      <p style={{ margin: 0, fontSize: 12, color: '#6b7280', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </p>
      <p style={{ margin: '10px 0 0', fontSize: 30, color: palette[1], fontWeight: 950 }}>
        {value}
      </p>
      {hint && <p style={{ margin: '5px 0 0', color: '#6b7280', fontSize: 12 }}>{hint}</p>}
    </div>
  );
};

const leerRespuestaJson = async (res, fallback) => {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();

  const text = await res.text();
  const pareceHtml = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');
  const detalle = pareceHtml
    ? 'El servidor devolvió HTML en vez de JSON. Normalmente significa que el API no está desplegado, la ruta está dando 404, o Vercel devolvió una página de error.'
    : text.slice(0, 240);

  return {
    ok: false,
    error: `${fallback}. HTTP ${res.status}. ${detalle}`,
  };
};

export default function ConciliacionCierres() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!active) return;
      setSession(currentSession);
      if (!currentSession) setLoading(false);
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
  }, [session, includeIgnored]);

  const token = session?.access_token;

  const cargarDatosDirectoSupabase = async () => {
    const { data: cierres, error: cierresError } = await supabase
      .from('cierres')
      .select('id, propiedad, fecha_cierre, comision, cobrado, pendiente, cobrado_bool, recibo_id, origen, notas, created_at, updated_at')
      .order('fecha_cierre', { ascending: false });

    if (cierresError) throw cierresError;

    const cierreIds = (cierres || []).map((cierre) => cierre.id).filter(Boolean);
    let pagos = [];

    if (cierreIds.length > 0) {
      const { data: pagosData, error: pagosError } = await supabase
        .from('cierre_pagos')
        .select('id, cierre_id, concepto, monto, fecha, metodo_pago, notas, created_at')
        .in('cierre_id', cierreIds)
        .order('fecha', { ascending: true });

      if (pagosError) throw pagosError;
      pagos = pagosData || [];
    }

    const reciboIds = [...new Set((cierres || []).map((cierre) => cierre.recibo_id).filter(Boolean))];
    let recibos = [];

    if (reciboIds.length > 0) {
      const { data: recibosData, error: recibosError } = await supabase
        .from('recibos_apartado')
        .select('id, folio, cliente_nombre, inmueble, monto, monto_total_acordado, fecha, forma_pago, created_at, recibos_abonos(id, monto, fecha, forma_pago, notas, created_at)')
        .in('id', reciboIds);

      if (recibosError) throw recibosError;
      recibos = recibosData || [];
    }

    const pagosPorCierre = new Map();
    pagos.forEach((pago) => {
      const key = String(pago.cierre_id);
      if (!pagosPorCierre.has(key)) pagosPorCierre.set(key, []);
      pagosPorCierre.get(key).push(pago);
    });

    const recibosPorId = new Map();
    recibos.forEach((recibo) => recibosPorId.set(String(recibo.id), recibo));

    const todos = (cierres || []).map((cierre) => {
      const pagosCierre = pagosPorCierre.get(String(cierre.id)) || [];
      const recibo = cierre.recibo_id ? recibosPorId.get(String(cierre.recibo_id)) : null;
      const clasificacion = clasificarConciliacionCierre({
        cierre,
        pagos: pagosCierre,
        recibo,
        ignorado: null,
      });

      return {
        id: cierre.id,
        propiedad: cierre.propiedad || '—',
        fecha_cierre: cierre.fecha_cierre,
        comision: redondearMoneda(cierre.comision || 0),
        cobrado_sistema: redondearMoneda(cierre.cobrado || 0),
        cobrado_trazable: sumarMontos(pagosCierre),
        pendiente_sistema: redondearMoneda(cierre.pendiente || 0),
        pendiente_reconstruido: clasificacion.pendiente_reconstruido,
        diferencia: clasificacion.diferencia,
        estado: clasificacion.estado,
        causa_probable: clasificacion.causa_probable,
        accion_sugerida: clasificacion.accion_sugerida,
        evidencia: clasificacion.evidencia,
        regularizacion: clasificacion.regularizacion,
        recibo_id: cierre.recibo_id || null,
        origen: cierre.origen || null,
        pagos_count: pagosCierre.length,
        created_at: cierre.created_at || null,
        updated_at: cierre.updated_at || null,
      };
    });

    const items = todos.filter((item) => {
      if (item.estado === 'conciliado') return false;
      if (item.estado === 'ignorado') return includeIgnored;
      return true;
    });

    return {
      ok: true,
      generated_at: new Date().toISOString(),
      source: 'supabase_direct',
      ignorados_disponibles: false,
      resumen: construirResumenConciliacion(todos),
      items,
    };
  };

  const cargarDatos = async () => {
    setLoading(true);
    setError('');

    try {
      if (!token) throw new Error('Sesión requerida');
      const directData = await cargarDatosDirectoSupabase();
      setData(directData);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setData(null);
      setError(err.message || 'Error al cargar conciliación');
    } finally {
      setLoading(false);
    }
  };

  const ejecutarAccion = async ({ action, cierreId, motivo }) => {
    if (!token) return;
    setSavingId(cierreId);
    setError('');

    try {
      const res = await fetch('/api/ejecutivo/conciliacion-cierres', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, cierre_id: cierreId, motivo }),
      });
      const json = await leerRespuestaJson(res, 'No se pudo ejecutar la acción');
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo ejecutar la acción');
      await cargarDatos();
    } catch (err) {
      setError(err.message || 'Error al ejecutar acción');
    } finally {
      setSavingId(null);
    }
  };

  const regularizar = async (item) => {
    const evidencia = item.evidencia?.descripcion || 'evidencia fuerte';
    const detalle = [
      `Cierre: #${item.id} · ${item.propiedad}`,
      `Pago a crear: ${fmtMoney(item.regularizacion?.monto)} como regularizacion_historica`,
      `Fecha del pago: ${item.regularizacion?.fecha || '—'}`,
      `Por qué puede regularizarse: ${item.causa_probable}`,
      `Evidencia utilizada: ${evidencia}`,
      `Campos que cambiarán: cierres.cobrado, cierres.pendiente y cobrado_bool se recalcularán desde cierre_pagos.`,
      '',
      'Para confirmar escribe: REGULARIZAR',
    ].join('\n');

    const respuesta = window.prompt(detalle);
    if (respuesta !== 'REGULARIZAR') return;
    await ejecutarAccion({ action: 'regularizar', cierreId: item.id });
  };

  const regularizarManual = async (item) => {
    const motivo = window.prompt([
      `Regularización manual del cierre #${item.id} · ${item.propiedad}`,
      `Monto a crear en cierre_pagos: ${fmtMoney(item.diferencia)}`,
      '',
      'Usa esto solo si tú confirmas que el cobro fue real aunque el sistema no tenga evidencia automática.',
      'Escribe el motivo para auditoría:',
    ].join('\n'));

    if (!motivo) return;

    const confirmacion = window.prompt([
      `Confirmación final para cierre #${item.id}`,
      `Se creará un pago por ${fmtMoney(item.diferencia)} con concepto regularizacion_historica_manual.`,
      'Después se recalcularán cierres.cobrado, cierres.pendiente y cobrado_bool desde cierre_pagos.',
      '',
      'Para confirmar escribe: REGULARIZAR MANUAL',
    ].join('\n'));

    if (confirmacion !== 'REGULARIZAR MANUAL') return;
    await ejecutarAccion({ action: 'regularizar_manual', cierreId: item.id, motivo });
  };

  const ignorar = async (item) => {
    const motivo = window.prompt([
      `Ignorar cierre #${item.id} · ${item.propiedad}`,
      'Esto no corrige datos; solo deja de mostrarlo como pendiente de conciliación.',
      'Escribe el motivo para auditoría:',
    ].join('\n'));
    if (!motivo) return;
    await ejecutarAccion({ action: 'ignorar', cierreId: item.id, motivo });
  };

  const resumen = data?.resumen || {};
  const items = data?.items || [];
  const montoDiferencia = useMemo(() => fmtMoney(resumen.monto_diferencia || 0), [resumen.monto_diferencia]);

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f8f7f4',
      padding: '32px 20px',
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#111827',
    }}>
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{
              display: 'inline-flex',
              margin: '0 0 10px',
              background: '#111827',
              color: '#fff',
              borderRadius: 999,
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 950,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}>
              Centro de Inteligencia · Control interno
            </p>
            <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1 }}>
              Conciliación de cierres
            </h1>
            <p style={{ margin: '10px 0 0', color: '#6b7280', fontSize: 15, maxWidth: 820 }}>
              Detecta diferencias entre el cobrado del cierre y los pagos trazables. Solo permite regularizar cuando existe evidencia fuerte.
            </p>
            <p style={{ margin: '8px 0 0', color: '#9ca3af', fontSize: 12 }}>
              Última actualización: {fmtDateTime(lastLoadedAt || data?.generated_at)}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <a href="/ejecutivo/bi-test" style={{ color: '#991b1b', textDecoration: 'none', fontWeight: 850, fontSize: 13 }}>
              ← Volver a BI test
            </a>
            <button onClick={cargarDatos} disabled={loading} style={{
              border: 'none',
              background: '#111827',
              color: '#fff',
              borderRadius: 10,
              padding: '10px 14px',
              fontWeight: 900,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.65 : 1,
            }}>
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </header>

        {!session && !loading && (
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 22 }}>
            Necesitas iniciar sesión en InmoAdmin para ver esta pantalla.
          </div>
        )}

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
            fontWeight: 750,
          }}>
            {error}
          </div>
        )}

        {session && (
          <>
            <section style={{ marginBottom: 18 }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Salud de conciliación</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                <StatCard label="Inconsistencias activas" value={resumen.total_inconsistencias || 0} hint={`Diferencia acumulada: ${montoDiferencia}`} />
                <StatCard label="Regularizables" value={resumen.regularizable || 0} hint="Evidencia fuerte" tone="green" />
                <StatCard label="Revisión manual" value={resumen.revision_recomendada || 0} hint="Indicios, requiere decisión" tone="yellow" />
                <StatCard label="Sin evidencia" value={resumen.sin_evidencia || 0} hint="No regularizar automático" tone="red" />
                <StatCard label="Conciliadas" value={resumen.conciliado || 0} hint="Sin diferencia" tone="green" />
                <StatCard label="Ignoradas" value={resumen.ignorado || 0} hint="Decisión consciente" tone="gray" />
              </div>
            </section>

            {!data?.ignorados_disponibles && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 14, padding: 14, marginBottom: 16, fontSize: 13 }}>
                El estado <strong>Ignorado</strong> está preparado, pero falta crear la tabla de persistencia <code>bi_conciliacion_ignorados</code>. La conciliación y regularización sí funcionan.
              </div>
            )}

            <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Casos pendientes</h2>
                  <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
                    Se ocultan los conciliados por defecto para mantener la lista accionable.
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#374151', fontSize: 13, fontWeight: 750 }}>
                  <input
                    type="checkbox"
                    checked={includeIgnored}
                    onChange={(event) => setIncludeIgnored(event.target.checked)}
                  />
                  Mostrar ignorados
                </label>
              </div>

              {loading ? (
                <div style={{ padding: 24, color: '#6b7280' }}>Cargando conciliación…</div>
              ) : items.length === 0 ? (
                <div style={{ padding: 24, color: '#047857', fontWeight: 850 }}>
                  No hay casos pendientes con los filtros actuales.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        <th style={th}>ID</th>
                        <th style={th}>Propiedad</th>
                        <th style={th}>Fecha</th>
                        <th style={thRight}>Comisión</th>
                        <th style={thRight}>Cobrado sistema</th>
                        <th style={thRight}>Cobrado trazable</th>
                        <th style={thRight}>Diferencia</th>
                        <th style={th}>Estado</th>
                        <th style={th}>Diagnóstico</th>
                        <th style={th}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} style={{ borderTop: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                          <td style={tdMono}>#{item.id}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 900 }}>{item.propiedad}</div>
                            <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 3 }}>
                              Pagos: {item.pagos_count} · Origen: {item.origen || '—'}
                            </div>
                          </td>
                          <td style={td}>{fmtDate(item.fecha_cierre)}</td>
                          <td style={tdRight}>{fmtMoney(item.comision)}</td>
                          <td style={tdRight}>{fmtMoney(item.cobrado_sistema)}</td>
                          <td style={tdRight}>{fmtMoney(item.cobrado_trazable)}</td>
                          <td style={{ ...tdRight, color: item.diferencia > 0 ? '#b91c1c' : '#047857', fontWeight: 950 }}>
                            {fmtMoney(item.diferencia)}
                          </td>
                          <td style={td}><Badge estado={item.estado} /></td>
                          <td style={{ ...td, maxWidth: 360 }}>
                            <div style={{ fontWeight: 850 }}>{item.causa_probable}</div>
                            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 5 }}>{item.accion_sugerida}</div>
                            {item.evidencia?.descripcion && (
                              <details style={{ marginTop: 8 }}>
                                <summary style={{ cursor: 'pointer', color: '#991b1b', fontWeight: 800, fontSize: 12 }}>Ver evidencia</summary>
                                <pre style={{ margin: '8px 0 0', background: '#111827', color: '#e5e7eb', borderRadius: 10, padding: 10, overflow: 'auto', maxWidth: 520, fontSize: 11 }}>
                                  {JSON.stringify(item.evidencia, null, 2)}
                                </pre>
                              </details>
                            )}
                          </td>
                          <td style={td}>
                            {item.estado === 'regularizable' ? (
                              <button onClick={() => regularizar(item)} disabled={savingId === item.id} style={primaryBtn}>
                                {savingId === item.id ? 'Regularizando…' : 'Regularizar'}
                              </button>
                            ) : (
                              <>
                                <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 750 }}>
                                  Requiere revisión manual
                                </div>
                                {item.estado !== 'conciliado' && item.estado !== 'ignorado' && item.diferencia > 0 && (
                                  <button onClick={() => regularizarManual(item)} disabled={savingId === item.id} style={manualBtn}>
                                    {savingId === item.id ? 'Regularizando…' : 'Regularizar manual'}
                                  </button>
                                )}
                              </>
                            )}
                            {item.estado !== 'ignorado' && item.estado !== 'conciliado' && (
                              <button onClick={() => ignorar(item)} disabled={savingId === item.id || !data?.ignorados_disponibles} style={secondaryBtn}>
                                Ignorar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const th = {
  textAlign: 'left',
  padding: '12px 14px',
  fontWeight: 950,
  borderBottom: '1px solid #e5e7eb',
};

const thRight = {
  ...th,
  textAlign: 'right',
};

const td = {
  padding: '13px 14px',
  fontSize: 13,
};

const tdRight = {
  ...td,
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

const tdMono = {
  ...td,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  color: '#6b7280',
  fontWeight: 850,
};

const primaryBtn = {
  display: 'block',
  width: '100%',
  border: 'none',
  background: '#047857',
  color: '#fff',
  borderRadius: 10,
  padding: '9px 10px',
  fontSize: 12,
  fontWeight: 950,
  cursor: 'pointer',
};

const secondaryBtn = {
  display: 'block',
  width: '100%',
  marginTop: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 850,
  cursor: 'pointer',
};

const manualBtn = {
  display: 'block',
  width: '100%',
  marginTop: 8,
  border: '1px solid #f59e0b',
  background: '#fffbeb',
  color: '#92400e',
  borderRadius: 10,
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 950,
  cursor: 'pointer',
};
