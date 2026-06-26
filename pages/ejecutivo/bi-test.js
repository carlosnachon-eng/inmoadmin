import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const fmtMoney = (value) => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const fmtDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const ESTADO_LABELS = {
  calculable: 'Calculable',
  parcial: 'Parcial',
  requiere_conciliacion: 'Requiere conciliación',
  no_disponible: 'No disponible',
};

const estadoStyle = (estado) => {
  if (estado === 'calculable') return { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
  if (estado === 'parcial') return { bg: '#fffbeb', color: '#92400e', border: '#fde68a' };
  if (estado === 'requiere_conciliacion') return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
  return { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' };
};

const EstadoBadge = ({ estado }) => {
  const st = estadoStyle(estado);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 999,
      border: `1px solid ${st.border}`,
      background: st.bg,
      color: st.color,
      padding: '4px 9px',
      fontSize: 11,
      fontWeight: 800,
      whiteSpace: 'nowrap',
    }}>
      {ESTADO_LABELS[estado] || estado || '—'}
    </span>
  );
};

const MetricCard = ({ title, value, estado, hint }) => (
  <div style={{
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 14,
    padding: 18,
    boxShadow: '0 1px 3px rgba(17, 24, 39, 0.06)',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <p style={{
        margin: 0,
        fontSize: 12,
        color: '#6b7280',
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        {title}
      </p>
      <EstadoBadge estado={estado} />
    </div>
    <p style={{ margin: '12px 0 0', fontSize: 30, color: '#111827', fontWeight: 900 }}>
      {fmtMoney(value)}
    </p>
    {hint && <p style={{ margin: '6px 0 0', color: '#9ca3af', fontSize: 12 }}>{hint}</p>}
  </div>
);

const UnidadSection = ({ titulo, unidad }) => {
  const metricas = unidad?.metricas || {};
  const estado = unidad?.conciliacion?.estado_confianza;

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#111827' }}>{titulo}</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            Estado general de la unidad: <EstadoBadge estado={estado} />
          </p>
        </div>
        <p style={{ margin: 0, color: '#9ca3af', fontSize: 12, textAlign: 'right' }}>
          Registros revisados: {unidad?.conciliacion?.registros_revisados ?? 0}
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 14,
      }}>
        <MetricCard
          title="Ingreso generado"
          value={metricas.ingreso_generado}
          estado={estado}
          hint="Fuente primaria del devengado"
        />
        <MetricCard
          title="Cobrado"
          value={metricas.cobrado}
          estado={estado}
          hint="Cobros del periodo por fecha real"
        />
        <MetricCard
          title="Pendiente reconstruido"
          value={metricas.pendiente_reconstruido}
          estado={estado}
          hint="Reconstruido desde documentos y pagos"
        />
      </div>

      <details style={{
        marginTop: 14,
        background: '#fff',
        border: '1px solid #eee',
        borderRadius: 12,
        padding: 14,
      }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800, color: '#374151' }}>
          Ver trazabilidad y conciliación
        </summary>
        <pre style={{
          margin: '14px 0 0',
          background: '#111827',
          color: '#e5e7eb',
          borderRadius: 10,
          padding: 14,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          {JSON.stringify({
            trazabilidad: unidad?.trazabilidad,
            conciliacion: unidad?.conciliacion,
          }, null, 2)}
        </pre>
      </details>
    </section>
  );
};

export default function BiTest() {
  const hoy = useMemo(() => new Date(), []);
  const [session, setSession] = useState(null);
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
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
  }, [session]);

  const cargarDatos = async () => {
    setLoading(true);
    setError('');

    try {
      const token = session?.access_token;
      if (!token) throw new Error('Sesión requerida');

      const res = await fetch(`/api/ejecutivo/bi-cierres-admin?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'No se pudo cargar lectura BI');
      }

      setData(json);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setData(null);
      setError(err.message || 'Error al cargar lectura BI');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f8f7f4',
      padding: '32px 20px',
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#111827',
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 18,
          flexWrap: 'wrap',
          marginBottom: 24,
        }}>
          <div>
            <p style={{
              display: 'inline-flex',
              margin: '0 0 10px',
              background: '#111827',
              color: '#fff',
              borderRadius: 999,
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}>
              Experimental · V0-08
            </p>
            <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1 }}>
              Centro de Inteligencia · Validación BI
            </h1>
            <p style={{ margin: '10px 0 0', color: '#6b7280', fontSize: 15, maxWidth: 760 }}>
              Pantalla temporal para validar la primera capa de lectura de cierres y administración.
              No es el dashboard definitivo.
            </p>
          </div>

          <a href="/ejecutivo" style={{
            color: '#991b1b',
            textDecoration: 'none',
            fontWeight: 800,
            fontSize: 13,
            paddingTop: 8,
          }}>
            ← Volver a Ejecutivo
          </a>
        </div>

        <div style={{
          background: '#fff',
          border: '1px solid #eee',
          borderRadius: 16,
          padding: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          boxShadow: '0 1px 3px rgba(17, 24, 39, 0.05)',
        }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 800, color: '#6b7280' }}>
            Año
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min="2020"
              max="2100"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 800, color: '#6b7280' }}>
            Mes
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={inputStyle}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </label>
          <button onClick={cargarDatos} disabled={loading || !session} style={{
            border: 0,
            borderRadius: 10,
            padding: '12px 16px',
            background: loading ? '#9ca3af' : '#991b1b',
            color: '#fff',
            fontWeight: 900,
            cursor: loading || !session ? 'not-allowed' : 'pointer',
          }}>
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
          <div style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
            <strong>Última carga:</strong> {fmtDateTime(lastLoadedAt || data?.generated_at)}
          </div>
        </div>

        {!session && !loading && (
          <div style={noticeStyle('#fef2f2', '#991b1b', '#fecaca')}>
            Sesión requerida. Entra primero a InmoAdmin y vuelve a abrir esta URL.
          </div>
        )}

        {error && (
          <div style={noticeStyle('#fef2f2', '#991b1b', '#fecaca')}>
            {error}
          </div>
        )}

        {data && (
          <>
            <section style={{
              marginTop: 22,
              background: '#fff',
              border: '1px solid #eee',
              borderRadius: 16,
              padding: 18,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: 0, color: '#6b7280', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>
                    Resumen V0-08
                  </p>
                  <h2 style={{ margin: '5px 0 0', fontSize: 24 }}>
                    {data.periodo?.periodKey} · Cierres + Administración
                  </h2>
                  <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 13 }}>
                    Generado por la API: {fmtDateTime(data.generated_at)}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 6px', color: '#6b7280', fontSize: 12, fontWeight: 800 }}>
                    Estado global
                  </p>
                  <EstadoBadge estado={data.estado_confianza} />
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14,
                marginTop: 16,
              }}>
                <MetricCard
                  title="Ingreso generado total"
                  value={data.metricas?.ingreso_generado}
                  estado={data.estado_confianza}
                />
                <MetricCard
                  title="Cobrado total"
                  value={data.metricas?.cobrado}
                  estado={data.estado_confianza}
                />
                <MetricCard
                  title="Pendiente reconstruido total"
                  value={data.metricas?.pendiente_reconstruido}
                  estado={data.estado_confianza}
                />
              </div>
            </section>

            <UnidadSection titulo="Cierres" unidad={data.unidades?.cierres} />
            <UnidadSection titulo="Administración" unidad={data.unidades?.administracion} />
          </>
        )}
      </div>
    </main>
  );
}

const inputStyle = {
  minWidth: 120,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '11px 12px',
  fontSize: 14,
  color: '#111827',
  background: '#fff',
  outline: 'none',
};

function noticeStyle(bg, color, border) {
  return {
    marginTop: 16,
    background: bg,
    color,
    border: `1px solid ${border}`,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    fontWeight: 700,
  };
}
