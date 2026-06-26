import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  ESTADOS_CONCILIACION_COMISIONES_ADMIN,
  clasificarComisionAdmin,
  construirResumenComisionesAdmin,
  periodoLabel,
  redondearMoneda,
} from '../../lib/ejecutivo/conciliacionComisionesAdmin';

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

const estadoInfo = (estado) => ESTADOS_CONCILIACION_COMISIONES_ADMIN[estado] || {
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
  }[tone] || ['#fff', '#111827'];

  return (
    <div style={{ background: palette[0], border: '1px solid #e5e7eb', borderRadius: 16, padding: 16, minHeight: 108 }}>
      <p style={{ margin: 0, fontSize: 12, color: '#6b7280', fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
      <p style={{ margin: '10px 0 0', fontSize: 30, color: palette[1], fontWeight: 950 }}>{value}</p>
      {hint && <p style={{ margin: '5px 0 0', color: '#6b7280', fontSize: 12 }}>{hint}</p>}
    </div>
  );
};

const leerRespuestaJson = async (res, fallback) => {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  const text = await res.text();
  return { ok: false, error: `${fallback}. HTTP ${res.status}. ${text.slice(0, 180)}` };
};

const uniq = (items) => [...new Set(items.filter(Boolean))];

export default function ConciliacionComisionesAdmin() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
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

  const token = session?.access_token;

  const cargarDatos = async () => {
    setLoading(true);
    setError('');

    try {
      const { data: comisiones, error: comisionesError } = await supabase
        .from('comisiones_admin')
        .select('id, contract_id, periodo, monto, tipo, status, fecha_cobro, notas, created_at')
        .eq('tipo', 'automatica')
        .eq('status', 'pendiente')
        .order('periodo', { ascending: false });

      if (comisionesError) throw comisionesError;

      const contractIds = uniq((comisiones || []).map((comision) => comision.contract_id));
      let contracts = [];
      if (contractIds.length > 0) {
        const { data, error } = await supabase
          .from('contracts')
          .select('id, property_id, tenant_name, property_name, owner_name, status, rent_receiver, commission_type, commission_value, monthly_rent')
          .in('id', contractIds);
        if (error) throw error;
        contracts = data || [];
      }

      const propertyIds = uniq(contracts.map((contract) => contract.property_id));
      const propertyNames = uniq(contracts.map((contract) => contract.property_name));
      let properties = [];
      if (propertyIds.length > 0) {
        const { data, error } = await supabase
          .from('properties')
          .select('id, name, owner_email, owner_phone, rent_amount')
          .in('id', propertyIds);
        if (error) throw error;
        properties = data || [];
      }
      if (propertyNames.length > 0) {
        const { data, error } = await supabase
          .from('properties')
          .select('id, name, owner_email, owner_phone, rent_amount')
          .in('name', propertyNames);
        if (error) throw error;
        const byId = new Map(properties.map((property) => [property.id, property]));
        (data || []).forEach((property) => byId.set(property.id, property));
        properties = [...byId.values()];
      }

      let payments = [];
      if (contractIds.length > 0) {
        const { data, error } = await supabase
          .from('payments')
          .select('id, contract_id, period_month, period_year, amount, due_date, payment_date, status, recibido_por, tenant_name, property_name')
          .in('contract_id', contractIds);
        if (error) throw error;
        payments = data || [];
      }

      const ownerEmails = uniq(properties.map((property) => property.owner_email));
      let ownerPayments = [];
      if (ownerEmails.length > 0) {
        const { data, error } = await supabase
          .from('owner_payments')
          .select('id, owner_name, owner_email, period_description, properties, total_rent, total_commission, total_liquid, amount_paid, payment_method, payment_date, status, notes, rent_receiver, created_at')
          .in('owner_email', ownerEmails);
        if (error) throw error;
        ownerPayments = data || [];
      }

      const periodos = uniq((comisiones || []).map((comision) => comision.periodo));
      const cashMovements = [];
      for (const periodo of periodos) {
        if (!/^\d{4}-\d{2}$/.test(periodo || '')) continue;
        const [year, month] = periodo.split('-').map(Number);
        const next = new Date(year, month, 1);
        const start = `${periodo}-01`;
        const endExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
        const { data, error } = await supabase
          .from('cash_movements')
          .select('id, type, category, description, amount, payment_method, date, notes, created_by, created_at')
          .gte('date', start)
          .lt('date', endExclusive);
        if (error) throw error;
        cashMovements.push(...(data || []));
      }

      const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
      const propertiesById = new Map(properties.map((property) => [property.id, property]));
      const propertiesByName = new Map(properties.map((property) => [property.name, property]));

      const items = (comisiones || []).map((comision) => {
        const contract = contractsById.get(comision.contract_id) || null;
        const property = contract?.property_id
          ? propertiesById.get(contract.property_id)
          : propertiesByName.get(contract?.property_name);
        const clasificacion = clasificarComisionAdmin({
          comision,
          contract,
          property,
          payments,
          ownerPayments,
          cashMovements,
        });

        return {
          id: comision.id,
          propietario: contract?.owner_name || '—',
          propiedad: contract?.property_name || property?.name || '—',
          contrato: contract?.id || '—',
          inquilino: contract?.tenant_name || '—',
          periodo: comision.periodo,
          periodo_label: periodoLabel(comision.periodo),
          renta: redondearMoneda(contract?.monthly_rent || 0),
          comision_emporio: redondearMoneda(comision.monto || 0),
          liquidacion_propietario: clasificacion.evidencia?.liquidacion?.amount_paid || 0,
          status_comision: comision.status,
          fecha_cobro: comision.fecha_cobro,
          estado: clasificacion.estado,
          causa_probable: clasificacion.causa_probable,
          accion_sugerida: clasificacion.accion_sugerida,
          evidencia: clasificacion.evidencia,
          regularizacion: clasificacion.regularizacion,
        };
      }).filter((item) => item.estado !== 'conciliada');

      setData({
        ok: true,
        generated_at: new Date().toISOString(),
        resumen: construirResumenComisionesAdmin(items),
        items,
      });
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setData(null);
      setError(err.message || 'Error al cargar conciliación de comisiones');
    } finally {
      setLoading(false);
    }
  };

  const regularizar = async (item) => {
    const detalle = [
      `Comisión: ${fmtMoney(item.comision_emporio)}`,
      `Propietario: ${item.propietario}`,
      `Propiedad: ${item.propiedad}`,
      `Periodo: ${item.periodo_label}`,
      `Liquidación encontrada: ${fmtMoney(item.liquidacion_propietario)}`,
      '',
      'Esto marcará la comisión como cobrada y creará/validará movimientos de caja necesarios.',
      'Para confirmar escribe: REGULARIZAR COMISION',
    ].join('\n');

    const respuesta = window.prompt(detalle);
    if (respuesta !== 'REGULARIZAR COMISION') return;

    setSavingId(item.id);
    setError('');
    try {
      const res = await fetch('/api/ejecutivo/conciliacion-comisiones-admin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'regularizar', comision_id: item.id }),
      });
      const json = await leerRespuestaJson(res, 'No se pudo regularizar comisión');
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo regularizar comisión');
      await cargarDatos();
    } catch (err) {
      setError(err.message || 'Error al regularizar comisión');
    } finally {
      setSavingId(null);
    }
  };

  const resumen = data?.resumen || {};
  const items = data?.items || [];
  const montoPendiente = useMemo(() => fmtMoney(resumen.monto_pendiente || 0), [resumen.monto_pendiente]);

  return (
    <main style={{
      minHeight: '100vh',
      background: '#f8f7f4',
      padding: '32px 20px',
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#111827',
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ display: 'inline-flex', margin: '0 0 10px', background: '#111827', color: '#fff', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 950, letterSpacing: 0.6, textTransform: 'uppercase' }}>
              Centro de Inteligencia · Administración
            </p>
            <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1 }}>Conciliación de comisiones de administración</h1>
            <p style={{ margin: '10px 0 0', color: '#6b7280', fontSize: 15, maxWidth: 880 }}>
              Detecta comisiones pendientes aunque la renta y la liquidación ya fueron procesadas.
            </p>
            <p style={{ margin: '8px 0 0', color: '#9ca3af', fontSize: 12 }}>
              Última actualización: {fmtDateTime(lastLoadedAt || data?.generated_at)}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <a href="/ejecutivo/bi-test" style={{ color: '#991b1b', textDecoration: 'none', fontWeight: 850, fontSize: 13 }}>← Volver a BI test</a>
            <button onClick={cargarDatos} disabled={loading} style={refreshBtn}>
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </header>

        {!session && !loading && (
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 22 }}>
            Necesitas iniciar sesión en InmoAdmin para ver esta pantalla.
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}

        {session && (
          <>
            <section style={{ marginBottom: 18 }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Salud de comisiones administración</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                <StatCard label="Pendientes detectadas" value={resumen.pendientes || 0} hint={`Monto pendiente: ${montoPendiente}`} />
                <StatCard label="Regularizables" value={resumen.regularizable || 0} hint="Evidencia fuerte" tone="green" />
                <StatCard label="Revisión manual" value={resumen.revision_recomendada || 0} hint="Indicios incompletos" tone="yellow" />
                <StatCard label="Sin evidencia" value={resumen.sin_evidencia || 0} hint="No regularizar automático" tone="red" />
              </div>
            </section>

            <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, overflow: 'hidden' }}>
              <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Casos pendientes</h2>
                <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
                  Solo se muestran comisiones automáticas pendientes de administración.
                </p>
              </div>

              {loading ? (
                <div style={{ padding: 24, color: '#6b7280' }}>Cargando conciliación…</div>
              ) : items.length === 0 ? (
                <div style={{ padding: 24, color: '#047857', fontWeight: 850 }}>No hay comisiones pendientes con evidencia revisable.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1320 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        <th style={th}>Propietario</th>
                        <th style={th}>Propiedad / Contrato</th>
                        <th style={th}>Periodo</th>
                        <th style={thRight}>Renta</th>
                        <th style={thRight}>Comisión</th>
                        <th style={thRight}>Liquidación</th>
                        <th style={th}>Estado comisión</th>
                        <th style={th}>Evidencia</th>
                        <th style={th}>Diagnóstico</th>
                        <th style={th}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} style={{ borderTop: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                          <td style={td}>
                            <div style={{ fontWeight: 900 }}>{item.propietario}</div>
                            <div style={{ color: '#9ca3af', fontSize: 11 }}>Inquilino: {item.inquilino}</div>
                          </td>
                          <td style={td}>
                            <div style={{ fontWeight: 850 }}>{item.propiedad}</div>
                            <div style={{ color: '#9ca3af', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{String(item.contrato).slice(0, 8)}</div>
                          </td>
                          <td style={td}>{item.periodo_label}</td>
                          <td style={tdRight}>{fmtMoney(item.renta)}</td>
                          <td style={tdRight}>{fmtMoney(item.comision_emporio)}</td>
                          <td style={tdRight}>{fmtMoney(item.liquidacion_propietario)}</td>
                          <td style={td}><Badge estado={item.estado} /><div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>{item.status_comision}</div></td>
                          <td style={{ ...td, maxWidth: 330 }}>
                            <details>
                              <summary style={{ cursor: 'pointer', color: '#991b1b', fontWeight: 800, fontSize: 12 }}>Ver evidencia</summary>
                              <pre style={{ margin: '8px 0 0', background: '#111827', color: '#e5e7eb', borderRadius: 10, padding: 10, overflow: 'auto', maxWidth: 520, fontSize: 11 }}>
                                {JSON.stringify(item.evidencia, null, 2)}
                              </pre>
                            </details>
                          </td>
                          <td style={{ ...td, maxWidth: 320 }}>
                            <div style={{ fontWeight: 850 }}>{item.causa_probable}</div>
                            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 5 }}>{item.accion_sugerida}</div>
                          </td>
                          <td style={td}>
                            {item.estado === 'regularizable' ? (
                              <button onClick={() => regularizar(item)} disabled={savingId === item.id} style={primaryBtn}>
                                {savingId === item.id ? 'Regularizando…' : 'Regularizar comisión'}
                              </button>
                            ) : (
                              <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 750 }}>Requiere revisión manual</div>
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

const th = { textAlign: 'left', padding: '12px 14px', fontWeight: 950, borderBottom: '1px solid #e5e7eb' };
const thRight = { ...th, textAlign: 'right' };
const td = { padding: '13px 14px', fontSize: 13 };
const tdRight = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const refreshBtn = { border: 'none', background: '#111827', color: '#fff', borderRadius: 10, padding: '10px 14px', fontWeight: 900, cursor: 'pointer' };
const errorBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 14, padding: 14, marginBottom: 16, fontWeight: 750 };
const primaryBtn = { display: 'block', width: '100%', border: 'none', background: '#047857', color: '#fff', borderRadius: 10, padding: '9px 10px', fontSize: 12, fontWeight: 950, cursor: 'pointer' };
