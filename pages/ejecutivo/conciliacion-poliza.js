import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  ESTADOS_CONCILIACION_POLIZA,
  construirConciliacionPoliza,
  coincideBusquedaPoliza,
  textoEvidencia,
} from '../../lib/ejecutivo/conciliacionPoliza';

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

const estadoInfo = (estado) => ESTADOS_CONCILIACION_POLIZA[estado] || {
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

const TIPO_LABEL = {
  expediente_poliza: 'Póliza',
  investigacion: 'Investigación',
  movimiento_caja: 'Caja',
};

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

const actionButton = {
  border: '1px solid #e5e7eb',
  background: '#fff',
  color: '#374151',
  borderRadius: 9,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 900,
  cursor: 'pointer',
};

export default function ConciliacionPoliza() {
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
  const [savingAction, setSavingAction] = useState('');

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

      const [expedientesRes, cajaRes, solicitudesRes] = await Promise.all([
        supabase.from('poliza_expedientes').select('*').order('created_at', { ascending: false }),
        supabase.from('poliza_caja').select('*').order('fecha', { ascending: false }),
        supabase.from('solicitudes_inquilino').select('*').order('created_at', { ascending: false }),
      ]);

      if (expedientesRes.error) throw expedientesRes.error;
      if (cajaRes.error) throw cajaRes.error;
      if (solicitudesRes.error) throw solicitudesRes.error;

      const conciliacion = construirConciliacionPoliza({
        expedientes: expedientesRes.data || [],
        solicitudes: solicitudesRes.data || [],
        caja: cajaRes.data || [],
      });

      setData({
        ok: true,
        generated_at: new Date().toISOString(),
        ...conciliacion,
      });
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setData(null);
      setError(err.message || 'No se pudo cargar conciliación de póliza.');
    } finally {
      setLoading(false);
    }
  };

  const ejecutarAccion = async (key, callback) => {
    setSavingAction(key);
    setError('');
    try {
      await callback();
      await cargarDatos();
    } catch (err) {
      setError(err.message || 'No se pudo ejecutar la acción.');
    } finally {
      setSavingAction('');
    }
  };

  const clasificarMovimiento = async (item) => {
    const movimiento = item?.evidencia?.caja?.[0];
    if (!item?.movimiento_id || !movimiento) return;

    const opciones = movimiento.tipo === 'egreso'
      ? [
        'gasto_juridico = gasto real del área jurídica, fuera de ingresos BI',
        'no_bi = excluir de BI / ajuste operativo',
      ]
      : [
        'investigacion = cobro de investigación',
        'anticipo_poliza = anticipo de póliza',
        'pago_poliza = pago completo de póliza',
        'saldo_poliza = saldo de póliza',
        'no_bi = excluir de BI / ajuste operativo',
      ];

    const nuevoConcepto = window.prompt([
      'Clasificar movimiento de Caja Póliza',
      '',
      `Movimiento: ${movimiento.fecha} · ${movimiento.tipo}/${movimiento.concepto}`,
      `Monto: ${fmtMoney(movimiento.monto)}`,
      `Descripción: ${movimiento.descripcion}`,
      '',
      'Escribe uno de estos valores:',
      ...opciones.map((opcion) => `- ${opcion}`),
    ].join('\n'));

    if (!nuevoConcepto) return;
    const concepto = nuevoConcepto.trim();
    const permitidos = movimiento.tipo === 'egreso'
      ? ['gasto_juridico', 'no_bi']
      : ['investigacion', 'anticipo_poliza', 'pago_poliza', 'saldo_poliza', 'no_bi'];
    if (!permitidos.includes(concepto)) {
      window.alert(`Concepto no válido. Usa: ${permitidos.join(', ')}`);
      return;
    }

    const confirmar = window.prompt([
      'Confirmación requerida',
      '',
      `Se actualizará poliza_caja ${String(item.movimiento_id).slice(0, 8)}`,
      `Concepto actual: ${movimiento.concepto}`,
      `Nuevo concepto: ${concepto}`,
      '',
      'Para confirmar escribe: CLASIFICAR',
    ].join('\n'));
    if (confirmar !== 'CLASIFICAR') return;

    await ejecutarAccion(`clasificar-${item.id}`, async () => {
      const { error: updateError } = await supabase
        .from('poliza_caja')
        .update({ concepto })
        .eq('id', item.movimiento_id);
      if (updateError) throw updateError;
    });
  };

  const vincularMovimiento = async (item, tipo) => {
    if (!item?.movimiento_id) return;
    const label = tipo === 'expediente' ? 'expediente' : 'solicitud';
    const campo = tipo === 'expediente' ? 'expediente_id' : 'solicitud_id';
    const limpiarCampo = tipo === 'expediente' ? 'solicitud_id' : 'expediente_id';
    const idDestino = window.prompt(`Pega el ID completo del ${label} que corresponde a este movimiento:`);
    if (!idDestino) return;

    const confirmar = window.prompt([
      'Confirmación requerida',
      '',
      `Se vinculará el movimiento ${String(item.movimiento_id).slice(0, 8)} al ${label}:`,
      idDestino,
      '',
      `También se limpiará ${limpiarCampo} para evitar doble vínculo.`,
      'Para confirmar escribe: VINCULAR',
    ].join('\n'));
    if (confirmar !== 'VINCULAR') return;

    await ejecutarAccion(`vincular-${item.id}`, async () => {
      const { error: updateError } = await supabase
        .from('poliza_caja')
        .update({ [campo]: idDestino.trim(), [limpiarCampo]: null })
        .eq('id', item.movimiento_id);
      if (updateError) throw updateError;
    });
  };

  const regularizarOperativo = async (item) => {
    if (item.estado !== 'regularizable') return;

    if (item.tipo === 'expediente_poliza') {
      const cubrePoliza = Number(item.cobrado_caja || 0) >= Number(item.monto_generado || 0) - 0.009;
      const payload = cubrePoliza
        ? { saldo_pagado: true, anticipo_pagado: item.anticipo_pagado_operativo || Number(item.cobrado_caja || 0) > 0 }
        : { anticipo_pagado: true };

      const confirmar = window.prompt([
        'Confirmación requerida',
        '',
        `Expediente: ${item.expediente_id}`,
        `Cliente: ${item.cliente}`,
        `Monto póliza: ${fmtMoney(item.monto_generado)}`,
        `Cobrado en caja: ${fmtMoney(item.cobrado_caja)}`,
        '',
        `Se actualizará: ${Object.entries(payload).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        'No se modificará caja.',
        '',
        'Para confirmar escribe: REGULARIZAR POLIZA',
      ].join('\n'));
      if (confirmar !== 'REGULARIZAR POLIZA') return;

      await ejecutarAccion(`regularizar-${item.id}`, async () => {
        const { error: updateError } = await supabase
          .from('poliza_expedientes')
          .update(payload)
          .eq('id', item.expediente_id);
        if (updateError) throw updateError;
      });
      return;
    }

    if (item.tipo === 'investigacion') {
      const movimiento = item?.evidencia?.caja?.[0];
      const confirmar = window.prompt([
        'Confirmación requerida',
        '',
        `Solicitud: ${item.solicitud_id}`,
        `Cliente: ${item.cliente}`,
        `Cobrado en caja: ${fmtMoney(item.cobrado_caja)}`,
        '',
        'Se marcará la investigación como cobrada.',
        'No se modificará caja.',
        '',
        'Para confirmar escribe: REGULARIZAR INVESTIGACION',
      ].join('\n'));
      if (confirmar !== 'REGULARIZAR INVESTIGACION') return;

      await ejecutarAccion(`regularizar-${item.id}`, async () => {
        const { error: updateError } = await supabase
          .from('solicitudes_inquilino')
          .update({
            cobro_investigacion: true,
            fecha_cobro_investigacion: movimiento?.fecha || new Date().toISOString().slice(0, 10),
            monto_investigacion: item.monto_generado || Math.abs(item.cobrado_caja || 0),
          })
          .eq('id', item.solicitud_id);
        if (updateError) throw updateError;
      });
    }
  };

  const renderAcciones = (item) => {
    const disabled = Boolean(savingAction);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 150 }}>
        {item.tipo === 'movimiento_caja' && item.evidencia?.caja?.[0]?.concepto === 'otro' && (
          <button disabled={disabled} onClick={() => clasificarMovimiento(item)} style={{ ...actionButton, color: '#991b1b' }}>
            Clasificar
          </button>
        )}
        {item.tipo === 'movimiento_caja' && !item.expediente_id && !item.solicitud_id && (
          <>
            <button disabled={disabled} onClick={() => vincularMovimiento(item, 'expediente')} style={actionButton}>
              Vincular expediente
            </button>
            <button disabled={disabled} onClick={() => vincularMovimiento(item, 'solicitud')} style={actionButton}>
              Vincular solicitud
            </button>
          </>
        )}
        {item.estado === 'regularizable' && (
          <button disabled={disabled} onClick={() => regularizarOperativo(item)} style={{ ...actionButton, color: '#047857' }}>
            Regularizar estado
          </button>
        )}
        {savingAction.endsWith(item.id) && <span style={{ color: '#6b7280', fontSize: 12 }}>Guardando…</span>}
      </div>
    );
  };

  const itemsFiltrados = useMemo(() => {
    const items = data?.items || [];
    return items.filter((item) => {
      if (!coincideBusquedaPoliza(item, busqueda)) return false;
      if (estadoFiltro === 'pendientes') return item.estado !== 'conciliado' && item.estado !== 'ignorado';
      if (estadoFiltro === 'todos') return true;
      return item.estado === estadoFiltro;
    });
  }, [data, busqueda, estadoFiltro]);

  if (authLoading) {
    return <main style={{ padding: 32, fontFamily: 'Inter, system-ui, sans-serif' }}>Cargando sesión…</main>;
  }

  if (!session) {
    return (
      <main style={{ padding: 32, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <h1>Conciliación de Póliza Jurídica</h1>
        <p>Necesitas iniciar sesión en InmoAdmin.</p>
      </main>
    );
  }

  const resumen = data?.resumen || {
    inconsistencias_activas: 0,
    regularizable: 0,
    revision_recomendada: 0,
    sin_evidencia: 0,
    conciliado: 0,
    ignorado: 0,
    movimientos_caja_revision: 0,
    diferencia_acumulada: 0,
  };

  return (
    <main style={{ minHeight: '100vh', background: '#f8f7f4', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif', padding: '34px 42px' }}>
      <section style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <p style={{
            display: 'inline-block',
            margin: '0 0 12px',
            background: '#111827',
            color: '#fff',
            borderRadius: 999,
            padding: '7px 12px',
            fontSize: 12,
            fontWeight: 950,
            letterSpacing: 1.1,
            textTransform: 'uppercase',
          }}>
            Centro de Inteligencia · Control Interno
          </p>
          <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1, letterSpacing: -1.5 }}>Conciliación de Póliza Jurídica</h1>
          <p style={{ margin: '14px 0 0', maxWidth: 900, color: '#6b7280', fontSize: 18 }}>
            Detecta diferencias entre el estado operativo de pólizas/investigaciones y la caja trazable del área jurídica. Las correcciones requieren confirmación explícita.
          </p>
          <p style={{ margin: '10px 0 0', color: '#9ca3af', fontSize: 13 }}>
            Última actualización: {fmtDateTime(lastLoadedAt)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="/ejecutivo/bi-test" style={{ color: '#991b1b', fontWeight: 900, textDecoration: 'none' }}>← Volver a BI test</a>
          <button onClick={cargarDatos} disabled={loading || !autorizado} style={{
            border: 'none',
            background: '#111827',
            color: '#fff',
            borderRadius: 12,
            padding: '12px 18px',
            fontWeight: 900,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.65 : 1,
          }}>
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </section>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 14, padding: '14px 18px', fontWeight: 800, marginBottom: 22 }}>
          {error}
        </div>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 24 }}>Salud de conciliación</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(150px, 1fr))', gap: 14 }}>
          <StatCard label="Inconsistencias activas" value={resumen.inconsistencias_activas} hint={`Diferencia: ${fmtMoney(resumen.diferencia_acumulada)}`} tone="default" />
          <StatCard label="Regularizables" value={resumen.regularizable} hint="Caja fuerte, estado operativo pendiente" tone="green" />
          <StatCard label="Revisión manual" value={resumen.revision_recomendada} hint="Indicios, requiere decisión" tone="yellow" />
          <StatCard label="Sin evidencia" value={resumen.sin_evidencia} hint="No integrar automático" tone="red" />
          <StatCard label="Conciliadas" value={resumen.conciliado} hint="Estado y caja coinciden" tone="green" />
          <StatCard label="Ignoradas" value={resumen.ignorado} hint="Pendiente persistencia" tone="gray" />
        </div>
      </section>

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '12px 16px', color: '#92400e', fontSize: 14, fontWeight: 700, marginBottom: 24 }}>
        Esta pantalla solo modifica datos cuando usas una acción y confirmas escribiendo la palabra solicitada. El estado <strong>Ignorado</strong> queda preparado para una futura tabla de persistencia, pero por ahora no se guarda.
      </div>

      <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: 18, display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 24 }}>Casos de conciliación</h2>
            <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 14 }}>
              Se ocultan conciliados por defecto para mantener la lista accionable.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Buscar cliente, inmueble, expediente…"
              style={{ width: 280, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 14 }}
            />
            <select
              value={estadoFiltro}
              onChange={(event) => setEstadoFiltro(event.target.value)}
              style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10, fontWeight: 800, color: '#374151', background: '#fff' }}
            >
              <option value="pendientes">Pendientes</option>
              <option value="todos">Todos</option>
              <option value="regularizable">Regularizables</option>
              <option value="revision_recomendada">Revisión recomendada</option>
              <option value="sin_evidencia">Sin evidencia</option>
              <option value="conciliado">Conciliados</option>
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1540 }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={th}>Tipo</th>
                <th style={th}>Cliente / arrendatario</th>
                <th style={th}>Inmueble</th>
                <th style={th}>Expediente</th>
                <th style={th}>Status operativo</th>
                <th style={th}>Monto póliza</th>
                <th style={th}>Cobrado caja</th>
                <th style={th}>Pendiente</th>
                <th style={th}>Anticipo op.</th>
                <th style={th}>Saldo op.</th>
                <th style={th}>Estado financiero</th>
                <th style={th}>Diferencia</th>
                <th style={th}>Estado</th>
                <th style={th}>Diagnóstico</th>
                <th style={th}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={15} style={{ ...td, padding: 32, textAlign: 'center', color: '#6b7280' }}>Cargando conciliación…</td></tr>
              )}
              {!loading && itemsFiltrados.length === 0 && (
                <tr><td colSpan={15} style={{ ...td, padding: 32, color: '#047857', fontSize: 18, fontWeight: 900 }}>No hay casos con los filtros actuales.</td></tr>
              )}
              {itemsFiltrados.map((item) => {
                const evidenciaAbierta = Boolean(mostrarEvidencia[item.id]);
                return (
                  <tr key={item.id}>
                    <td style={td}>
                      <strong>{TIPO_LABEL[item.tipo] || item.tipo}</strong>
                    </td>
                    <td style={td}>
                      <strong>{item.cliente}</strong>
                      {item.solicitud_id && <span style={{ display: 'block', color: '#9ca3af', fontSize: 11 }}>Solicitud: {String(item.solicitud_id).slice(0, 8)}</span>}
                    </td>
                    <td style={{ ...td, maxWidth: 240 }}>{item.inmueble}</td>
                    <td style={td}>{item.expediente_id ? String(item.expediente_id).slice(0, 8) : '—'}</td>
                    <td style={td}>
                      <strong>{item.status_operativo}</strong>
                      {item.status_expediente !== '—' && <span style={{ display: 'block', color: '#9ca3af', fontSize: 11 }}>{item.status_expediente}</span>}
                    </td>
                    <td style={tdRight}>{fmtMoney(item.monto_generado)}</td>
                    <td style={tdRight}>{fmtMoney(item.cobrado_caja)}</td>
                    <td style={tdRight}>{fmtMoney(item.pendiente_calculado)}</td>
                    <td style={td}><BoolCell value={item.anticipo_pagado_operativo} /></td>
                    <td style={td}><BoolCell value={item.saldo_pagado_operativo} /></td>
                    <td style={td}><strong>{item.estado_financiero}</strong></td>
                    <td style={{ ...tdRight, color: Math.abs(item.diferencia || 0) > 0.009 ? '#b91c1c' : '#047857' }}>{fmtMoney(item.diferencia)}</td>
                    <td style={td}><Badge estado={item.estado} /></td>
                    <td style={{ ...td, minWidth: 340 }}>
                      <strong>{item.causa_probable}</strong>
                      <p style={{ margin: '6px 0 8px', color: '#6b7280', lineHeight: 1.35 }}>{item.accion_sugerida}</p>
                      <button
                        onClick={() => setMostrarEvidencia((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                        style={{ border: 'none', background: 'transparent', color: '#991b1b', fontWeight: 900, cursor: 'pointer', padding: 0 }}
                      >
                        {evidenciaAbierta ? '▾ Ocultar evidencia' : '▸ Ver evidencia'}
                      </button>
                      {evidenciaAbierta && (
                        <pre style={{
                          margin: '10px 0 0',
                          background: '#111827',
                          color: '#e5e7eb',
                          borderRadius: 10,
                          padding: 12,
                          whiteSpace: 'pre-wrap',
                          fontSize: 11,
                          lineHeight: 1.45,
                          maxWidth: 520,
                        }}>
                          {textoEvidencia(item)}
                        </pre>
                      )}
                    </td>
                    <td style={td}>{renderAcciones(item)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
