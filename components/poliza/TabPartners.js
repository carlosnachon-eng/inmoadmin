import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, fmt } from '../../lib/polizaUtils'
import { PARTNER_STATUS, calcCommission, COMMISSION_RATE } from '../../lib/partners'

const statusOptions = Object.entries(PARTNER_STATUS)
const commissionFilters = [
  { value: 'todas', label: 'Todas las comisiones' },
  { value: 'por_generar', label: 'Por generar' },
  { value: 'por_pagar', label: 'Por pagar' },
  { value: 'pagadas', label: 'Pagadas' },
]

export default function TabPartners({ operaciones, agencias = [], onReload }) {
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [agencyFilter, setAgencyFilter] = useState('todas')
  const [commissionFilter, setCommissionFilter] = useState('todas')
  const pendientes = agencias.filter(a => a.status === 'pendiente')
  const agenciasActivas = agencias.filter(a => a.status === 'activo')

  const resumen = useMemo(() => {
    const totalGenerado = operaciones.reduce((acc, op) => acc + (Number(op.commission_generated) || 0), 0)
    const totalPagado = operaciones.reduce((acc, op) => acc + (Number(op.commission_paid) || 0), 0)
    const porPagar = operaciones.reduce((acc, op) => acc + Math.max(0, (Number(op.commission_generated) || 0) - (Number(op.commission_paid) || 0)), 0)
    return {
      operaciones: operaciones.length,
      activas: operaciones.filter(op => op.status_partner === 'activa').length,
      pendientes: operaciones.filter(op => !['activa', 'rechazada', 'cancelada'].includes(op.status_partner)).length,
      partners: agenciasActivas.length,
      totalGenerado,
      totalPagado,
      porPagar,
    }
  }, [operaciones, agenciasActivas.length])

  const operacionesFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return operaciones.filter(op => {
      const generated = Number(op.commission_generated) || 0
      const paid = Number(op.commission_paid) || 0
      const matchesText = !q || [
        op.folio,
        op.nombre_inquilino,
        op.nombre_propietario,
        op.direccion_inmueble,
        op.partner_agencies?.nombre_comercial,
      ].some(v => String(v || '').toLowerCase().includes(q))
      const matchesStatus = statusFilter === 'todos' || op.status_partner === statusFilter
      const matchesAgency = agencyFilter === 'todas' || op.partner_agency_id === agencyFilter
      const matchesCommission =
        commissionFilter === 'todas' ||
        (commissionFilter === 'por_generar' && generated <= 0 && op.status_partner === 'activa') ||
        (commissionFilter === 'por_pagar' && generated > paid) ||
        (commissionFilter === 'pagadas' && generated > 0 && paid >= generated)
      return matchesText && matchesStatus && matchesAgency && matchesCommission
    })
  }, [operaciones, search, statusFilter, agencyFilter, commissionFilter])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('todos')
    setAgencyFilter('todas')
    setCommissionFilter('todas')
  }

  const saveSelected = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const payload = {
        status_partner: selected.status_partner,
        observaciones_publicas: selected.observaciones_publicas || null,
        observaciones_internas: selected.observaciones_internas || null,
        monto_poliza_final: selected.monto_poliza_final === '' ? null : Number(selected.monto_poliza_final) || null,
        updated_at: new Date().toISOString(),
      }
      await supabase.from('partner_operations').update(payload).eq('id', selected.id)
      setSelected(null)
      onReload()
    } finally {
      setSaving(false)
    }
  }

  const generarComision = async (op) => {
    const expediente = op.poliza_expedientes
    if (!op.poliza_expediente_id || !expediente) {
      alert('Primero vincula la operacion a un expediente de poliza.')
      return
    }
    if (expediente.status !== 'activo' || !expediente.saldo_pagado) {
      alert('La comision solo se puede generar cuando la poliza esta activa y cobrada.')
      return
    }
    const base = Number(op.monto_poliza_final || op.monto_poliza_estimado) || 0
    if (!base) {
      alert('Captura monto final o estimado de poliza antes de generar comision.')
      return
    }
    const rate = Number(op.commission_rate || COMMISSION_RATE)
    const amount = calcCommission(base, rate)
    await supabase.from('partner_operations').update({
      status_partner: 'activa',
      monto_poliza_final: base,
      commission_generated: amount,
      commission_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', op.id)
    onReload()
  }

  const marcarPagada = async (op) => {
    const amount = Number(op.commission_generated) || 0
    if (!amount) {
      alert('Primero genera la comision.')
      return
    }
    await supabase.from('partner_operations').update({
      commission_paid: amount,
      commission_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', op.id)
    onReload()
  }

  const actualizarAgencia = async (agencia, status) => {
    await supabase.from('partner_agencies').update({
      status,
      approved_at: status === 'activo' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', agencia.id)
    onReload()
  }

  if (!operaciones?.length && !pendientes.length && !agenciasActivas.length) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin partners registrados</p>
      <p>Cuando una inmobiliaria solicite acceso o envie una operacion aparecera aqui.</p>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 22 }}>
        <Summary label="Operaciones" value={resumen.operaciones} hint={`${resumen.pendientes} en proceso`} />
        <Summary label="Partners activos" value={resumen.partners} hint={`${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} de aprobacion`} />
        <Summary label="Por pagar" value={fmt(resumen.porPagar)} hint="Comisiones generadas no pagadas" tone="gold" />
        <Summary label="Pagado" value={fmt(resumen.totalPagado)} hint={`Generado ${fmt(resumen.totalGenerado)}`} tone="green" />
      </div>

      {pendientes.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <p style={st.sectionTitle}>Solicitudes de acceso por aprobar</p>
          <p style={st.sectionSub}>Inmobiliarias o asesores que pidieron entrar al programa Partner y esperan activacion de Emporio.</p>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {pendientes.map(ag => (
              <div key={ag.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                  {ag.logo_url ? (
                    <img src={ag.logo_url} alt={ag.nombre_comercial} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'contain', border: `1px solid ${C.border}` }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 8, background: ag.brand_color || C.gold, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900 }}>{ag.nombre_comercial?.[0] || 'P'}</div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, color: C.text, fontWeight: 850 }}>{ag.nombre_comercial}</p>
                    <p style={{ margin: '3px 0 0', color: C.muted, fontSize: 12 }}>{ag.email_contacto || '-'} · {ag.telefono || '-'} · {ag.ciudad || '-'}</p>
                    {ag.website && <p style={{ margin: '3px 0 0', color: C.muted, fontSize: 11 }}>{ag.website}</p>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => actualizarAgencia(ag, 'activo')} style={{ ...st.btn, ...st.btnGreen, padding: '7px 12px', fontSize: 12 }}>Aprobar</button>
                  <button onClick={() => actualizarAgencia(ag, 'suspendido')} style={{ ...st.btn, background: C.red, color: '#fff', padding: '7px 12px', fontSize: 12 }}>Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {agenciasActivas.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <p style={st.sectionTitle}>Partners activos</p>
          <p style={st.sectionSub}>Inmobiliarias y asesores aprobados para enviar operaciones a Emporio Blindaje Legal.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginTop: 12 }}>
            {agenciasActivas.map(ag => {
              const operacionesAgencia = operaciones.filter(op => op.partner_agency_id === ag.id)
              return (
                <div key={ag.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                    {ag.logo_url ? (
                      <img src={ag.logo_url} alt={ag.nombre_comercial} style={{ width: 46, height: 46, borderRadius: 8, objectFit: 'contain', border: `1px solid ${C.border}` }} />
                    ) : (
                      <div style={{ width: 46, height: 46, borderRadius: 8, background: ag.brand_color || C.gold, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900 }}>{ag.nombre_comercial?.[0] || 'P'}</div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, color: C.text, fontWeight: 850 }}>{ag.nombre_comercial}</p>
                      <p style={{ margin: '3px 0 0', color: C.muted, fontSize: 12 }}>{ag.email_contacto || '-'} · {ag.telefono || '-'}</p>
                      <p style={{ margin: '3px 0 0', color: C.greenText, fontSize: 11, fontWeight: 800 }}>{operacionesAgencia.length} operacion{operacionesAgencia.length === 1 ? '' : 'es'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <p style={st.sectionTitle}>Operaciones y expedientes de partners</p>
        <p style={st.sectionSub}>Solicitudes enviadas por partners. Cuando se vinculan a un expediente, el seguimiento y comisiones viven aqui.</p>
      </div>

      {operaciones.length === 0 ? (
        <div style={{ ...st.emptyState, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '34px 20px' }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Sin operaciones partner todavía</p>
          <p style={{ margin: '6px 0 0' }}>Cuando un partner cree una operacion, aparecera en este bloque.</p>
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'center' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por partner, inquilino, propietario, folio o direccion..."
                style={st.input}
              />
              <select value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)} style={st.input}>
                <option value="todas">Todas las inmobiliarias</option>
                {agencias.map(ag => <option key={ag.id} value={ag.id}>{ag.nombre_comercial}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={st.input}>
                <option value="todos">Todos los estatus</option>
                {statusOptions.map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
              </select>
              <select value={commissionFilter} onChange={e => setCommissionFilter(e.target.value)} style={st.input}>
                {commissionFilters.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <button onClick={clearFilters} style={{ ...st.btn, ...st.btnGhost, whiteSpace: 'nowrap' }}>Limpiar</button>
            </div>
            <p style={{ margin: '10px 0 0', color: C.muted, fontSize: 12, fontWeight: 700 }}>
              Mostrando {operacionesFiltradas.length} de {operaciones.length} operacion{operaciones.length === 1 ? '' : 'es'}
            </p>
          </div>

          {operacionesFiltradas.length === 0 && (
            <div style={{ ...st.emptyState, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 14 }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Sin resultados con esos filtros</p>
              <p style={{ margin: '6px 0 0' }}>Prueba limpiar filtros o buscar por otro dato.</p>
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            {operacionesFiltradas.map(op => (
              <div key={op.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, color: C.text, fontSize: 15, fontWeight: 800 }}>{op.nombre_inquilino || 'Inquilino pendiente'}</p>
                <p style={{ margin: '3px 0 0', color: C.muted, fontSize: 12 }}>{op.direccion_inmueble || '-'} · {op.folio || op.id.slice(0, 8).toUpperCase()}</p>
                <p style={{ margin: '5px 0 0', color: C.muted, fontSize: 11 }}>
                  Partner: <strong>{op.partner_agencies?.nombre_comercial || 'Aliado'}</strong> · Propietario: {op.nombre_propietario || '-'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={statusBadgeStyle(op.status_partner)}>
                  {PARTNER_STATUS[op.status_partner]?.label || op.status_partner}
                </span>
                <button onClick={() => setSelected(op)} style={{ ...st.btn, ...st.btnGhost, padding: '7px 12px', fontSize: 12 }}>Gestionar</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
              <Mini label="Poliza" value={fmt(op.monto_poliza_final || op.monto_poliza_estimado)} />
              <Mini label="Comision estimada" value={fmt(op.commission_estimated)} />
              <Mini label="Comision generada" value={fmt(op.commission_generated)} />
              <Mini label="Comision pagada" value={fmt(op.commission_paid)} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {op.solicitud_inquilino_id && (
                <button onClick={() => window.open(`/poliza/solicitud/${op.solicitud_inquilino_id}`, '_blank')} style={{ ...st.btn, padding: '7px 12px', fontSize: 12, background: C.blueBg, color: C.blueText }}>
                  Ver solicitud
                </button>
              )}
              <button onClick={() => generarComision(op)} style={{ ...st.btn, padding: '7px 12px', fontSize: 12, ...st.btnGreen }}>
                Generar comision
              </button>
              <button onClick={() => marcarPagada(op)} style={{ ...st.btn, padding: '7px 12px', fontSize: 12, ...st.btnGold }}>
                Marcar pagada
              </button>
            </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <div style={st.modal} onClick={e => e.target === e.currentTarget && setSelected(null)}>
          <div style={{ ...st.modalCard, maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <div>
                <h2 style={{ margin: 0, color: C.text, fontSize: 20 }}>{selected.nombre_inquilino || 'Operacion partner'}</h2>
                <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 12 }}>{selected.partner_agencies?.nombre_comercial || 'Aliado'}</p>
              </div>
              <button onClick={() => setSelected(null)} style={{ ...st.btn, ...st.btnGhost }}>x</button>
            </div>

            <div style={st.grid2}>
              <div>
                <label style={st.label}>Status visible al partner</label>
                <select value={selected.status_partner || 'recibida'} onChange={e => setSelected(s => ({ ...s, status_partner: e.target.value }))} style={st.input}>
                  {statusOptions.map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </select>
              </div>
              <div>
                <label style={st.label}>Monto final poliza</label>
                <input type="number" value={selected.monto_poliza_final || ''} onChange={e => setSelected(s => ({ ...s, monto_poliza_final: e.target.value }))} style={st.input} />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={st.label}>Observaciones visibles al partner</label>
              <textarea value={selected.observaciones_publicas || ''} onChange={e => setSelected(s => ({ ...s, observaciones_publicas: e.target.value }))} rows={4} style={{ ...st.input, resize: 'vertical' }} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={st.label}>Notas internas Emporio</label>
              <textarea value={selected.observaciones_internas || ''} onChange={e => setSelected(s => ({ ...s, observaciones_internas: e.target.value }))} rows={3} style={{ ...st.input, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setSelected(null)} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
              <button onClick={saveSelected} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? .6 : 1 }}>{saving ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10 }}>
      <p style={{ margin: '0 0 4px', color: C.muted, fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: 0, color: C.text, fontSize: 14, fontWeight: 800 }}>{value}</p>
    </div>
  )
}

function Summary({ label, value, hint, tone = 'neutral' }) {
  const palette = {
    neutral: { bg: '#fff', color: C.text },
    gold: { bg: C.goldLight, color: C.goldText },
    green: { bg: C.greenBg, color: C.greenText },
  }[tone] || { bg: '#fff', color: C.text }
  return (
    <div style={{ background: palette.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <p style={{ margin: 0, color: C.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '6px 0 0', color: palette.color, fontSize: 22, fontWeight: 900 }}>{value}</p>
      <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 11 }}>{hint}</p>
    </div>
  )
}

function statusBadgeStyle(status) {
  const tone = PARTNER_STATUS[status]?.tone || 'neutral'
  const tones = {
    green: { bg: C.greenBg, color: C.greenText },
    red: { bg: C.redBg, color: C.redText },
    blue: { bg: C.blueBg, color: C.blueText },
    amber: { bg: '#fffbeb', color: '#92400e' },
    purple: { bg: '#f5f3ff', color: '#5b21b6' },
    neutral: { bg: '#f3f4f6', color: C.muted },
  }
  const p = tones[tone] || tones.neutral
  return {
    background: p.bg,
    color: p.color,
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  }
}
