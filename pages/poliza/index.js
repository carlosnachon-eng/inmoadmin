import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

// ─── Colores ───────────────────────────────────────────────
const C = {
  bg: '#0F0F0F', card: '#161616', border: '#222', border2: '#2E2E2E',
  gold: '#C8973A', goldLight: '#C8973A20', goldText: '#E8B86D',
  green: '#2A5C3F', greenText: '#5EC98A', greenBg: '#1A2E20',
  red: '#8B3A3A', redText: '#E07070', redBg: '#2A1A1A',
  blue: '#1A3A5C', blueText: '#70A8E0', blueBg: '#1A2A3A',
  text: '#E8E8E8', muted: '#888', faint: '#444',
  white: '#FFFFFF',
}

const STATUS_LABELS = {
  pendiente:   { label: 'Pendiente',   color: C.goldText,  bg: C.goldLight },
  en_revision: { label: 'En revisión', color: C.blueText,  bg: C.blueBg },
  aprobado:    { label: 'Aprobado',    color: C.greenText, bg: C.greenBg },
  rechazado:   { label: 'Rechazado',   color: C.redText,   bg: C.redBg },
  borrador:    { label: 'Borrador',    color: C.muted,     bg: '#1A1A1A' },
  completo:    { label: 'Completo',    color: C.blueText,  bg: C.blueBg },
  firmado:     { label: 'Firmado',     color: C.greenText, bg: C.greenBg },
  activo:      { label: 'Activo',      color: C.greenText, bg: C.greenBg },
  vencido:     { label: 'Vencido',     color: C.redText,   bg: C.redBg },
}

const Badge = ({ status }) => {
  const bs = STATUS_LABELS[status] || { label: status, color: C.muted, bg: '#1A1A1A' }
  return (
    <span style={{ background: bs.bg, color: bs.color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: '0.3px' }}>
      {bs.label}
    </span>
  )
}

const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── Número a letra (básico para montos) ──────────────────
const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function cientos(n) {
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100), d = Math.floor((n % 100) / 10), u = n % 10
  let r = CENTENAS[c] ? CENTENAS[c] + ' ' : ''
  if (d === 1 && u > 0) r += UNIDADES[10 + u]
  else if (d === 2 && u > 0) r += 'VEINTI' + UNIDADES[u]
  else { if (d > 0) r += DECENAS[d]; if (d > 0 && u > 0) r += ' Y '; if (u > 0) r += UNIDADES[u] }
  return r.trim()
}

function numeroALetra(n) {
  if (!n || isNaN(n)) return ''
  const entero = Math.floor(n), cents = Math.round((n - entero) * 100)
  let r = ''
  if (entero === 0) r = 'CERO'
  else if (entero < 1000) r = cientos(entero)
  else if (entero < 2000) r = 'MIL ' + (entero % 1000 > 0 ? cientos(entero % 1000) : '')
  else r = cientos(Math.floor(entero / 1000)) + ' MIL ' + (entero % 1000 > 0 ? cientos(entero % 1000) : '')
  return r.trim() + ' ' + String(cents).padStart(2, '0') + '/100 M.N.'
}

// ─── Calcular 12 fechas de pagarés ───────────────────────
function calcularPagares(fechaInicio) {
  if (!fechaInicio) return {}
  const dates = {}
  const base = new Date(fechaInicio + 'T12:00:00')
  for (let i = 1; i <= 12; i++) {
    const d = new Date(base)
    d.setMonth(d.getMonth() + i)
    dates[`fecha_pagare_${i}`] = d.toISOString().split('T')[0]
  }
  return dates
}

// ─── Estilos base ─────────────────────────────────────────
const st = {
  page: { minHeight: '100vh', background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif", color: C.text },
  header: { background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 20, height: 60 },
  logo: { height: 32, objectFit: 'contain' },
  headerTitle: { fontSize: 15, fontWeight: 700, color: C.white },
  headerSub: { fontSize: 12, color: C.muted },
  nav: { display: 'flex', gap: 4, marginLeft: 32 },
  navBtn: { padding: '6px 16px', borderRadius: 8, border: 'none', background: 'transparent', color: C.muted, fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  navBtnActive: { background: C.goldLight, color: C.goldText },
  main: { maxWidth: 1100, margin: '0 auto', padding: '28px 20px' },
  sectionTitle: { fontSize: 20, fontWeight: 700, color: C.white, margin: '0 0 4px', fontFamily: 'Georgia, serif' },
  sectionSub: { fontSize: 13, color: C.muted, margin: '0 0 24px' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' },
  tableHead: { background: '#111', borderBottom: `1px solid ${C.border}` },
  th: { padding: '12px 16px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' },
  td: { padding: '14px 16px', fontSize: 13, borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle' },
  trHover: { cursor: 'pointer', transition: 'background 0.15s' },
  btn: { padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.15s' },
  btnGold: { background: C.gold, color: '#000' },
  btnGhost: { background: 'transparent', border: `1px solid ${C.border2}`, color: C.muted },
  btnGreen: { background: C.green, color: C.greenText },
  btnRed: { background: C.red, color: C.redText },
  input: { width: '100%', background: '#1E1E1E', border: `1px solid ${C.border2}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: '0.3px' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '40px 16px' },
  modalCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: 720, padding: 32 },
  divider: { height: 1, background: C.border, margin: '24px 0' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 },
  emptyState: { textAlign: 'center', padding: '60px 20px', color: C.muted },
}

// ═══════════════════════════════════════════════════════════
export default function PolizaPanel() {
  const router = useRouter()
  const [tab, setTab] = useState('expedientes')
  const [expedientes, setExpedientes] = useState([])
  const [propietarios, setPropietarios] = useState([])
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // 'nuevo' | 'expediente' | 'propietario' | 'solicitud'
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: exp }, { data: prop }, { data: sol }] = await Promise.all([
      supabase.from('poliza_expedientes').select('*').order('created_at', { ascending: false }),
      supabase.from('propietarios_inmuebles').select('*').order('created_at', { ascending: false }),
      supabase.from('solicitudes_inquilino').select('*').order('created_at', { ascending: false }),
    ])
    setExpedientes(exp || [])
    setPropietarios(prop || [])
    setSolicitudes(sol || [])
    setLoading(false)
  }

  // ── Tabs ──────────────────────────────────────────────────
  const tabs = [
    { id: 'expedientes', label: `Expedientes (${expedientes.length})` },
    { id: 'propietarios', label: `Propietarios (${propietarios.length})` },
    { id: 'solicitudes', label: `Solicitudes (${solicitudes.length})` },
  ]

  return (
    <div style={st.page}>
      {/* Header */}
      <header style={st.header}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={st.logo} />
        <div>
          <p style={st.headerTitle}>Panel Jurídico</p>
          <p style={st.headerSub}>Pólizas · Contratos · Expedientes</p>
        </div>
        <nav style={st.nav}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...st.navBtn, ...(tab === t.id ? st.navBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => { setSelected(null); setModal('nuevo') }}
            style={{ ...st.btn, ...st.btnGold }}>
            + Nuevo expediente
          </button>
        </div>
      </header>

      <main style={st.main}>
        {loading ? (
          <div style={st.emptyState}><p>Cargando...</p></div>
        ) : (
          <>
            {tab === 'expedientes' && <TabExpedientes expedientes={expedientes} propietarios={propietarios} solicitudes={solicitudes} onSelect={e => { setSelected(e); setModal('expediente') }} />}
            {tab === 'propietarios' && <TabPropietarios propietarios={propietarios} onSelect={p => { setSelected(p); setModal('propietario') }} />}
            {tab === 'solicitudes' && <TabSolicitudes solicitudes={solicitudes} onSelect={s => { setSelected(s); setModal('solicitud') }} onNuevoExp={sol => { setSelected({ _solicitud: sol }); setModal('nuevo') }} />}
          </>
        )}
      </main>

      {/* Modales */}
      {modal === 'nuevo' && (
        <ModalNuevoExpediente
          propietarios={propietarios}
          solicitudes={solicitudes}
          prefill={selected?._solicitud}
          onClose={() => { setModal(null); setSelected(null) }}
          onSaved={() => { setModal(null); setSelected(null); loadAll() }}
        />
      )}
      {modal === 'expediente' && selected && (
        <ModalExpediente
          expediente={selected}
          propietarios={propietarios}
          solicitudes={solicitudes}
          onClose={() => { setModal(null); setSelected(null) }}
          onSaved={() => { setModal(null); setSelected(null); loadAll() }}
        />
      )}
      {modal === 'propietario' && selected && (
        <ModalPropietario
          propietario={selected}
          onClose={() => { setModal(null); setSelected(null) }}
          onSaved={() => { setModal(null); setSelected(null); loadAll() }}
          onNuevoExp={() => { setModal('nuevo') }}
        />
      )}
      {modal === 'solicitud' && selected && (
        <ModalSolicitud
          solicitud={selected}
          onClose={() => { setModal(null); setSelected(null) }}
          onSaved={() => { setModal(null); setSelected(null); loadAll() }}
          onNuevoExp={() => { setSelected({ _solicitud: selected }); setModal('nuevo') }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB EXPEDIENTES
// ═══════════════════════════════════════════════════════════
function TabExpedientes({ expedientes, propietarios, solicitudes, onSelect }) {
  if (expedientes.length === 0) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 40, margin: '0 0 12px' }}>📁</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin expedientes aún</p>
      <p>Crea el primer expediente con el botón de arriba</p>
    </div>
  )

  const getProp = (id) => propietarios.find(p => p.id === id)
  const getSol = (id) => solicitudes.find(s => st.id === id)

  return (
    <div>
      <p style={st.sectionTitle}>Expedientes de póliza</p>
      <p style={st.sectionSub}>Haz clic en un expediente para editarlo o generar documentos</p>
      <div style={st.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={st.tableHead}>
            <tr>
              <th style={st.th}>Arrendatario</th>
              <th style={st.th}>Inmueble</th>
              <th style={st.th}>Renta</th>
              <th style={st.th}>Inicio</th>
              <th style={st.th}>Tipo</th>
              <th style={st.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {expedientes.map(e => (
              <tr key={e.id} onClick={() => onSelect(e)}
                style={st.trHover}
                onMouseEnter={el => el.currentTarget.style.background = '#1A1A1A'}
                onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                <td style={st.td}>
                  <p style={{ margin: 0, fontWeight: 600, color: C.white }}>{e.nombre_arrendatario || '—'}</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{e.nombre_arrendador || '—'}</p>
                </td>
                <td style={st.td}>
                  <p style={{ margin: 0, fontSize: 12, color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.direccion_inmueble || '—'}</p>
                </td>
                <td style={st.td}><span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(e.renta_mensual)}</span></td>
                <td style={st.td}><span style={{ color: C.muted, fontSize: 12 }}>{fmtDate(e.fecha_inicio)}</span></td>
                <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{e.tipo_contrato?.replace(/_/g, ' ') || '—'}</span></td>
                <td style={st.td}><Badge status={e.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB PROPIETARIOS
// ═══════════════════════════════════════════════════════════
function TabPropietarios({ propietarios, onSelect }) {
  if (propietarios.length === 0) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 40, margin: '0 0 12px' }}>🏠</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin propietarios registrados</p>
      <p>Comparte el link de registro con los propietarios</p>
      <div style={{ marginTop: 16, background: '#1A1A1A', borderRadius: 8, padding: '10px 18px', display: 'inline-block' }}>
        <code style={{ color: C.goldText, fontSize: 13 }}>app.emporioinmobiliario.com.mx/registro-propietario</code>
      </div>
    </div>
  )

  return (
    <div>
      <p style={st.sectionTitle}>Propietarios e inmuebles</p>
      <p style={st.sectionSub}>Registros enviados por los propietarios</p>
      <div style={st.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={st.tableHead}>
            <tr>
              <th style={st.th}>Propietario</th>
              <th style={st.th}>Inmueble</th>
              <th style={st.th}>Renta</th>
              <th style={st.th}>Tipo</th>
              <th style={st.th}>Fecha</th>
              <th style={st.th}>Admin</th>
            </tr>
          </thead>
          <tbody>
            {propietarios.map(p => (
              <tr key={p.id} onClick={() => onSelect(p)}
                style={st.trHover}
                onMouseEnter={el => el.currentTarget.style.background = '#1A1A1A'}
                onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                <td style={st.td}>
                  <p style={{ margin: 0, fontWeight: 600, color: C.white }}>{p.nombre_propietario}</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{p.telefono_propietario}</p>
                </td>
                <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{p.direccion_inmueble}</span></td>
                <td style={st.td}><span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(p.monto_renta)}</span></td>
                <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{p.tipo_inmueble?.replace(/_/g, ' ') || '—'}</span></td>
                <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{fmtDate(p.created_at?.split('T')[0])}</span></td>
                <td style={st.td}>{p.contrato_administracion ? <Badge status="activo" /> : <span style={{ color: C.faint, fontSize: 11 }}>Solo renta</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB SOLICITUDES
// ═══════════════════════════════════════════════════════════
function TabSolicitudes({ solicitudes, onSelect, onNuevoExp }) {
  if (solicitudes.length === 0) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 40, margin: '0 0 12px' }}>📋</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin solicitudes aún</p>
      <p>Comparte el link con los inquilinos interesados</p>
      <div style={{ marginTop: 16, background: '#1A1A1A', borderRadius: 8, padding: '10px 18px', display: 'inline-block' }}>
        <code style={{ color: C.goldText, fontSize: 13 }}>app.emporioinmobiliario.com.mx/solicitud-inquilino</code>
      </div>
    </div>
  )

  return (
    <div>
      <p style={st.sectionTitle}>Solicitudes de investigación</p>
      <p style={st.sectionSub}>Solicitudes enviadas por inquilinos interesados</p>
      <div style={st.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={st.tableHead}>
            <tr>
              <th style={st.th}>Solicitante</th>
              <th style={st.th}>Inmueble de interés</th>
              <th style={st.th}>Ingresos</th>
              <th style={st.th}>Fecha</th>
              <th style={st.th}>Status</th>
              <th style={st.th}></th>
            </tr>
          </thead>
          <tbody>
            {solicitudes.map(sol => (
              <tr key={sol.id}
                style={st.trHover}
                onMouseEnter={el => el.currentTarget.style.background = '#1A1A1A'}
                onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                <td style={st.td} onClick={() => onSelect(sol)}>
                  <p style={{ margin: 0, fontWeight: 600, color: C.white }}>{sol.nombre_completo || sol.razon_social || '—'}</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{sol.telefono}</p>
                </td>
                <td style={st.td} onClick={() => onSelect(sol)}><span style={{ fontSize: 12, color: C.muted }}>{sol.inmueble_interes || '—'}</span></td>
                <td style={st.td} onClick={() => onSelect(sol)}><span style={{ color: C.goldText }}>{fmt(sol.ingresos_mensuales || sol.ingresos_empresa)}</span></td>
                <td style={st.td} onClick={() => onSelect(sol)}><span style={{ fontSize: 11, color: C.muted }}>{fmtDate(sol.created_at?.split('T')[0])}</span></td>
                <td style={st.td} onClick={() => onSelect(sol)}><Badge status={sol.status} /></td>
                <td style={st.td}>
                  {sol.status === 'aprobado' && (
                    <button onClick={() => onNuevoExp(sol)} style={{ ...st.btn, ...st.btnGold, padding: '6px 12px', fontSize: 11 }}>
                      + Expediente
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MODAL NUEVO EXPEDIENTE
// ═══════════════════════════════════════════════════════════
function ModalNuevoExpediente({ propietarios, solicitudes, prefill, onClose, onSaved }) {
  const [propId, setPropId] = useState(prefill ? '' : '')
  const [solId, setSolId] = useState(prefill?.id || '')
  const [form, setForm] = useState({
    tipo_contrato: 'habitacional_sin_muebles',
    incluye_administracion: false,
    // Arrendador
    nombre_arrendador: '', domicilio_arrendador: '', rfc_arrendador: '',
    clave_elector_arrendador: '', telefono_arrendador: '', correo_arrendador: '',
    // Arrendatario
    nombre_arrendatario: '', domicilio_arrendatario: '', rfc_arrendatario: '',
    clave_elector_arrendatario: '', telefono_arrendatario: '', correo_arrendatario: '',
    ocupacion_arrendatario: '', comprobante_ingresos: '',
    // Inmueble
    direccion_inmueble: '', ciudad_estado_inmueble: 'San Andrés Cholula, Puebla',
    // Económico
    renta_mensual: '', cuota_mantenimiento: '', deposito_garantia: '', forma_pago: 'efectivo',
    banco_receptor: '', clabe_interbancaria: '', dia_limite_pago: '5',
    // Fechas
    fecha_inicio: '', fecha_firma: '',
    fecha_entrega_posesion: '',
    // Mascotas
    mascotas_permitidas: 'no', detalle_mascotas: '',
    // Póliza
    monto_poliza: '',
    status: 'borrador',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Pre-llenar desde propietario
  useEffect(() => {
    if (!propId) return
    const p = propietarios.find(x => x.id === propId)
    if (!p) return
    setForm(f => ({
      ...f,
      nombre_arrendador: p.nombre_propietario || '',
      domicilio_arrendador: p.domicilio_propietario || '',
      rfc_arrendador: p.rfc_propietario || '',
      telefono_arrendador: p.telefono_propietario || '',
      correo_arrendador: p.correo_propietario || '',
      clave_elector_arrendador: p.clave_elector_propietario || '',
      direccion_inmueble: p.direccion_inmueble || '',
      renta_mensual: p.monto_renta || '',
      forma_pago: p.forma_pago || 'efectivo',
      banco_receptor: p.banco || '',
      clabe_interbancaria: p.clabe || '',
      mascotas_permitidas: p.mascotas_permitidas || 'no',
      detalle_mascotas: p.detalle_mascotas || '',
      incluye_administracion: p.contrato_administracion || false,
    }))
  }, [propId])

  // Pre-llenar desde solicitud
  useEffect(() => {
    if (!solId) return
    const sol = solicitudes.find(x => x.id === solId)
    if (!sol) return
    setForm(f => ({
      ...f,
      nombre_arrendatario: sol.nombre_completo || sol.razon_social || '',
      domicilio_arrendatario: sol.domicilio_actual || '',
      rfc_arrendatario: sol.rfc || sol.rfc_empresa || '',
      telefono_arrendatario: sol.telefono || '',
      correo_arrendatario: sol.correo || '',
      clave_elector_arrendatario: sol.clave_elector || '',
      ocupacion_arrendatario: sol.empresa_labora || sol.giro_empresa || '',
      comprobante_ingresos: sol.tipo_ingresos || '',
    }))
  }, [solId])

  // Auto-calcular depósito y mora al cambiar renta
  useEffect(() => {
    const r = parseFloat(form.renta_mensual)
    if (!r) return
    setForm(f => ({
      ...f,
      deposito_garantia: r,
      mora_diaria: (r * 0.01).toFixed(2),
    }))
  }, [form.renta_mensual])

  // Auto-calcular fecha término
  const fechaTermino = form.fecha_inicio
    ? (() => { const d = new Date(form.fecha_inicio + 'T12:00:00'); d.setFullYear(d.getFullYear() + 1); return d.toISOString().split('T')[0] })()
    : ''

  const handleSave = async () => {
    if (!form.nombre_arrendador || !form.nombre_arrendatario || !form.fecha_inicio) {
      setMsg('Completa al menos: arrendador, arrendatario y fecha de inicio')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const r = parseFloat(form.renta_mensual) || 0
      const dep = parseFloat(form.deposito_garantia) || 0
      const mora = parseFloat((r * 0.01).toFixed(2))
      const pagares = calcularPagares(form.fecha_inicio)

      const payload = {
        ...form,
        propietario_id: propId || null,
        inquilino_id: solId || null,
        renta_mensual: r,
        cuota_mantenimiento: mant,
        renta_mensual_letra: numeroALetra(r),
        deposito_garantia: dep,
        deposito_garantia_letra: numeroALetra(dep),
        mora_diaria: mora,
        mora_diaria_letra: numeroALetra(mora),
        monto_poliza: parseFloat(form.monto_poliza) || null,
        monto_poliza_letra: form.monto_poliza ? numeroALetra(parseFloat(form.monto_poliza)) : null,
        dia_limite_pago: parseInt(form.dia_limite_pago) || 5,
        fecha_termino: fechaTermino || null,
        ...pagares,
      }
      delete payload.mora_diaria_campo // limpieza

      const { error } = await supabase.from('poliza_expedientes').insert(payload)
      if (error) throw error
      onSaved()
    } catch (e) {
      setMsg('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.white, fontFamily: 'Georgia, serif' }}>Nuevo expediente</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        {/* Selector propietario / solicitud */}
        <div style={st.grid2}>
          <div>
            <label style={st.label}>Propietario registrado</label>
            <select value={propId} onChange={e => setPropId(e.target.value)} style={st.input}>
              <option value="">— Seleccionar o capturar abajo —</option>
              {propietarios.map(p => <option key={p.id} value={p.id}>{p.nombre_propietario} · {p.direccion_inmueble?.slice(0, 30)}...</option>)}
            </select>
          </div>
          <div>
            <label style={st.label}>Solicitud de inquilino</label>
            <select value={solId} onChange={e => setSolId(e.target.value)} style={st.input}>
              <option value="">— Seleccionar o capturar abajo —</option>
              {solicitudes.map(sol => <option key={sol.id} value={sol.id}>{sol.nombre_completo || sol.razon_social} · {sol.status}</option>)}
            </select>
          </div>
        </div>

        <div style={{ ...st.divider, margin: '20px 0' }} />

        {/* Tipo de contrato */}
        <div style={{ marginBottom: 20 }}>
          <label style={st.label}>Tipo de contrato</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { v: 'habitacional_sin_muebles', l: 'Casa sin muebles' },
              { v: 'habitacional_amueblada', l: 'Casa amueblada' },
              { v: 'comercial', l: 'Comercial' },
            ].map(opt => (
              <button key={opt.v} type="button" onClick={() => set('tipo_contrato', opt.v)}
                style={{ ...st.btn, ...(form.tipo_contrato === opt.v ? st.btnGold : st.btnGhost), padding: '7px 14px', fontSize: 12 }}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        {/* ARRENDADOR */}
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Arrendador (Dueño)</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Nombre completo</label>
    <input type="text" value={form.nombre_arrendador || ''} onChange={e => set('nombre_arrendador', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>RFC</label>
    <input type="text" value={form.rfc_arrendador || ''} onChange={e => set('rfc_arrendador', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Clave de elector</label>
    <input type="text" value={form.clave_elector_arrendador || ''} onChange={e => set('clave_elector_arrendador', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Teléfono</label>
    <input type="text" value={form.telefono_arrendador || ''} onChange={e => set('telefono_arrendador', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Correo</label>
    <input type="text" value={form.correo_arrendador || ''} onChange={e => set('correo_arrendador', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Domicilio</label>
    <input type="text" value={form.domicilio_arrendador || ''} onChange={e => set('domicilio_arrendador', e.target.value)} style={st.input} />
  </div>
        </div>

        <div style={{ ...st.divider, margin: '16px 0' }} />

        {/* ARRENDATARIO */}
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Arrendatario (Inquilino)</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Nombre completo</label>
    <input type="text" value={form.nombre_arrendatario || ''} onChange={e => set('nombre_arrendatario', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>RFC</label>
    <input type="text" value={form.rfc_arrendatario || ''} onChange={e => set('rfc_arrendatario', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Clave de elector</label>
    <input type="text" value={form.clave_elector_arrendatario || ''} onChange={e => set('clave_elector_arrendatario', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Teléfono</label>
    <input type="text" value={form.telefono_arrendatario || ''} onChange={e => set('telefono_arrendatario', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Correo</label>
    <input type="text" value={form.correo_arrendatario || ''} onChange={e => set('correo_arrendatario', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Ocupación / Actividad</label>
    <input type="text" value={form.ocupacion_arrendatario || ''} onChange={e => set('ocupacion_arrendatario', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Comprobante de ingresos presentado</label>
    <input type="text" value={form.comprobante_ingresos || ''} onChange={e => set('comprobante_ingresos', e.target.value)} placeholder="Ej: Estados de cuenta, Recibos de nómina..." style={st.input} />
  </div>

        <div style={{ ...st.divider, margin: '16px 0' }} />

        {/* INMUEBLE */}
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inmueble</p>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Dirección completa</label>
    <input type="text" value={form.direccion_inmueble || ''} onChange={e => set('direccion_inmueble', e.target.value)} style={st.input} />
  </div>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Ciudad y estado</label>
    <input type="text" value={form.ciudad_estado_inmueble || ''} onChange={e => set('ciudad_estado_inmueble', e.target.value)} style={st.input} />
  </div>

        <div style={{ ...st.divider, margin: '16px 0' }} />

        {/* CONDICIONES ECONÓMICAS */}
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Condiciones económicas</p>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Renta mensual $</label>
    <input type="number" value={form.renta_mensual || ''} onChange={e => set('renta_mensual', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Cuota mantenimiento $</label>
    <input type="number" value={form.cuota_mantenimiento || ''} onChange={e => set('cuota_mantenimiento', e.target.value)} placeholder="0 si no aplica" style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Depósito en garantía $</label>
    <input type="number" value={form.deposito_garantia || ''} onChange={e => set('deposito_garantia', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Mora diaria 1% $</label>
    <input type="number" value={form.mora_diaria || (parseFloat(form.renta_mensual) * 0.01).toFixed(2) || '' || ''} onChange={e => set('mora_diaria', e.target.value)} style={st.input} />
  </div>
          <div>
            <label style={st.label}>Forma de pago</label>
            <select value={form.forma_pago} onChange={e => set('forma_pago', e.target.value)} style={st.input}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="deposito">Depósito</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Banco receptor</label>
    <input type="text" value={form.banco_receptor || ''} onChange={e => set('banco_receptor', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Día límite de pago</label>
    <input type="number" value={form.dia_limite_pago || ''} onChange={e => set('dia_limite_pago', e.target.value)} placeholder="Ej: 5" style={st.input} />
  </div>
        </div>
        {(form.forma_pago === 'transferencia' || form.forma_pago === 'deposito') && (
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>CLABE interbancaria</label>
    <input type="text" value={form.clabe_interbancaria || ''} onChange={e => set('clabe_interbancaria', e.target.value)} style={st.input} />
  </div>
        )}
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Monto de póliza $</label>
    <input type="number" value={form.monto_poliza || ''} onChange={e => set('monto_poliza', e.target.value)} placeholder="Costo del servicio de póliza jurídica" style={st.input} />
  </div>

        <div style={{ ...st.divider, margin: '16px 0' }} />

        {/* FECHAS */}
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Fechas</p>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Fecha de inicio</label>
    <input type="date" value={form.fecha_inicio || ''} onChange={e => set('fecha_inicio', e.target.value)} style={st.input} />
  </div>
          <div>
            <label style={st.label}>Fecha de término</label>
            <input value={fechaTermino} readOnly style={{ ...st.input, color: C.muted, cursor: 'not-allowed' }} />
            <p style={{ margin: '4px 0 0', fontSize: 10, color: C.faint }}>Se calcula automáticamente (1 año)</p>
          </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Entrega de posesión</label>
    <input type="date" value={form.fecha_entrega_posesion || ''} onChange={e => set('fecha_entrega_posesion', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Fecha de firma del contrato</label>
    <input type="date" value={form.fecha_firma || ''} onChange={e => set('fecha_firma', e.target.value)} style={st.input} />
  </div>

        {form.fecha_inicio && (
          <div style={{ background: '#111', borderRadius: 8, padding: '12px 16px', marginTop: 8 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.muted }}>PAGARÉS — 12 fechas calculadas automáticamente</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(calcularPagares(form.fecha_inicio)).map(([k, v]) => (
                <span key={k} style={{ background: '#1A1A1A', border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, color: C.muted }}>
                  {fmtDate(v)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...st.divider, margin: '16px 0' }} />

        {/* MASCOTAS */}
        <div style={st.grid2}>
          <div>
            <label style={st.label}>Mascotas permitidas</label>
            <select value={form.mascotas_permitidas} onChange={e => set('mascotas_permitidas', e.target.value)} style={st.input}>
              <option value="no">No</option>
              <option value="si">Sí</option>
              <option value="condicionado">Condicionado</option>
            </select>
          </div>
          {form.mascotas_permitidas !== 'no' && (
            <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Detalle mascotas</label>
    <input type="text" value={form.detalle_mascotas || ''} onChange={e => set('detalle_mascotas', e.target.value)} style={st.input} />
  </div>
          )}
        </div>

        {/* Administración */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="admin" checked={form.incluye_administracion} onChange={e => set('incluye_administracion', e.target.checked)} style={{ accentColor: C.gold, width: 16, height: 16 }} />
          <label htmlFor="admin" style={{ fontSize: 13, color: C.muted, cursor: 'pointer' }}>Incluye contrato de administración</label>
        </div>

        {msg && <p style={{ color: C.redText, fontSize: 13, margin: '16px 0 0' }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 28 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando...' : 'Crear expediente'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MODAL EXPEDIENTE (ver/editar)
// ═══════════════════════════════════════════════════════════
function ModalExpediente({ expediente, propietarios, solicitudes, onClose, onSaved }) {
  const [form, setForm] = useState({ ...expediente })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const r = parseFloat(form.renta_mensual) || 0
      const dep = parseFloat(form.deposito_garantia) || 0
      const mora = parseFloat((r * 0.01).toFixed(2))
      const pagares = form.fecha_inicio ? calcularPagares(form.fecha_inicio) : {}
      const fechaTermino = form.fecha_inicio
        ? (() => { const d = new Date(form.fecha_inicio + 'T12:00:00'); d.setFullYear(d.getFullYear() + 1); return d.toISOString().split('T')[0] })()
        : form.fecha_termino

      const { error } = await supabase.from('poliza_expedientes').update({
        ...form,
        renta_mensual: r,
        renta_mensual_letra: numeroALetra(r),
        deposito_garantia: dep,
        deposito_garantia_letra: numeroALetra(dep),
        mora_diaria: mora,
        mora_diaria_letra: numeroALetra(mora),
        monto_poliza: parseFloat(form.monto_poliza) || null,
        monto_poliza_letra: form.monto_poliza ? numeroALetra(parseFloat(form.monto_poliza)) : null,
        fecha_termino: fechaTermino,
        ...pagares,
      }).eq('id', expediente.id)
      if (error) throw error
      onSaved()
    } catch (e) {
      setMsg('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.white, fontFamily: 'Georgia, serif' }}>
              {form.nombre_arrendatario || 'Expediente'}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>ID: {expediente.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={form.status} onChange={e => set('status', e.target.value)} style={{ ...st.input, width: 'auto', fontSize: 12 }}>
              {['borrador', 'completo', 'firmado', 'activo', 'vencido', 'cancelado'].map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
          </div>
        </div>

        {/* Mismos campos que nuevo pero con datos pre-llenados */}
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase' }}>Arrendador</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Nombre</label>
    <input type="text" value={form.nombre_arrendador || ''} onChange={e => set('nombre_arrendador', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>RFC</label>
    <input type="text" value={form.rfc_arrendador || ''} onChange={e => set('rfc_arrendador', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Clave de elector</label>
    <input type="text" value={form.clave_elector_arrendador || ''} onChange={e => set('clave_elector_arrendador', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Teléfono</label>
    <input type="text" value={form.telefono_arrendador || ''} onChange={e => set('telefono_arrendador', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Correo</label>
    <input type="text" value={form.correo_arrendador || ''} onChange={e => set('correo_arrendador', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Domicilio</label>
    <input type="text" value={form.domicilio_arrendador || ''} onChange={e => set('domicilio_arrendador', e.target.value)} style={st.input} />
  </div>
        </div>

        <div style={st.divider} />
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase' }}>Arrendatario</p>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Nombre</label>
    <input type="text" value={form.nombre_arrendatario || ''} onChange={e => set('nombre_arrendatario', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>RFC</label>
    <input type="text" value={form.rfc_arrendatario || ''} onChange={e => set('rfc_arrendatario', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Clave de elector</label>
    <input type="text" value={form.clave_elector_arrendatario || ''} onChange={e => set('clave_elector_arrendatario', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Teléfono</label>
    <input type="text" value={form.telefono_arrendatario || ''} onChange={e => set('telefono_arrendatario', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid2}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Correo</label>
    <input type="text" value={form.correo_arrendatario || ''} onChange={e => set('correo_arrendatario', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Ocupación</label>
    <input type="text" value={form.ocupacion_arrendatario || ''} onChange={e => set('ocupacion_arrendatario', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Comprobante de ingresos</label>
    <input type="text" value={form.comprobante_ingresos || ''} onChange={e => set('comprobante_ingresos', e.target.value)} style={st.input} />
  </div>

        <div style={st.divider} />
        <p style={{ fontSize: 12, fontWeight: 700, color: C.goldText, margin: '0 0 12px', textTransform: 'uppercase' }}>Inmueble y condiciones</p>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Dirección</label>
    <input type="text" value={form.direccion_inmueble || ''} onChange={e => set('direccion_inmueble', e.target.value)} style={st.input} />
  </div>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Renta mensual $</label>
    <input type="number" value={form.renta_mensual || ''} onChange={e => set('renta_mensual', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Cuota mantenimiento $</label>
    <input type="number" value={form.cuota_mantenimiento || ''} onChange={e => set('cuota_mantenimiento', e.target.value)} placeholder="0 si no aplica" style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Depósito $</label>
    <input type="number" value={form.deposito_garantia || ''} onChange={e => set('deposito_garantia', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Monto póliza $</label>
    <input type="number" value={form.monto_poliza || ''} onChange={e => set('monto_poliza', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={st.grid3}>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Fecha inicio</label>
    <input type="date" value={form.fecha_inicio || ''} onChange={e => set('fecha_inicio', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Fecha firma</label>
    <input type="date" value={form.fecha_firma || ''} onChange={e => set('fecha_firma', e.target.value)} style={st.input} />
  </div>
          <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Entrega posesión</label>
    <input type="date" value={form.fecha_entrega_posesion || ''} onChange={e => set('fecha_entrega_posesion', e.target.value)} style={st.input} />
  </div>
        </div>
        <div style={{ marginBottom: 14 }}>
    <label style={st.label}>Notas</label>
    <input type="text" value={form.notas || ''} onChange={e => set('notas', e.target.value)} placeholder="Observaciones internas..." style={st.input} />
  </div>

        {msg && <p style={{ color: C.redText, fontSize: 13, margin: '12px 0 0' }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 28 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MODAL PROPIETARIO (ver detalle)
// ═══════════════════════════════════════════════════════════
function ModalPropietario({ propietario: p, onClose, onSaved, onNuevoExp }) {
  const [status, setStatus] = useState(p.status || 'activo')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('propietarios_inmuebles').update({ status }).eq('id', p.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.white, fontFamily: 'Georgia, serif' }}>{p.nombre_propietario}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={p.telefono_propietario} />
          <InfoRow label="Correo" value={p.correo_propietario} />
          <InfoRow label="RFC" value={p.rfc_propietario} />
          <InfoRow label="Clave elector" value={p.clave_elector_propietario} />
          <InfoRow label="Renta" value={fmt(p.monto_renta)} />
          <InfoRow label="Forma de pago" value={p.forma_pago} />
        </div>
        {p.banco && <InfoRow label="Banco / CLABE" value={`${p.banco} · ${p.clabe}`} />}
        <InfoRow label="Inmueble" value={p.direccion_inmueble} />
        <InfoRow label="Domicilio propietario" value={p.domicilio_propietario} />

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <label style={st.label}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={st.input}>
              <option value="activo">Activo</option>
              <option value="rentado">Rentado</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
          <div style={{ paddingTop: 18 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold }}>
              {saving ? 'Guardando...' : 'Actualizar'}
            </button>
          </div>
        </div>

        {/* Documentos */}
        {(p.doc_identificacion || p.doc_comprobante_domicilio || p.doc_predial) && (
          <>
            <div style={{ ...st.divider, margin: '16px 0' }} />
            <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', margin: '0 0 10px' }}>Documentos</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.doc_identificacion && <DocChip label="Identificación" path={p.doc_identificacion} />}
              {p.doc_comprobante_domicilio && <DocChip label="Comprobante domicilio" path={p.doc_comprobante_domicilio} />}
              {p.doc_predial && <DocChip label="Predial" path={p.doc_predial} />}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onNuevoExp} style={{ ...st.btn, ...st.btnGold }}>+ Crear expediente</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MODAL SOLICITUD (ver detalle + cambiar status)
// ═══════════════════════════════════════════════════════════
function ModalSolicitud({ solicitud: sol, onClose, onSaved, onNuevoExp }) {
  const [status, setStatus] = useState(sol.status || 'pendiente')
  const [notas, setNotas] = useState(sol.notas_juridico || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('solicitudes_inquilino').update({ status, notas_juridico: notas }).eq('id', sol.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div style={st.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.white, fontFamily: 'Georgia, serif' }}>{sol.nombre_completo || sol.razon_social}</h2>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>✕</button>
        </div>

        <div style={st.grid2}>
          <InfoRow label="Teléfono" value={sol.telefono} />
          <InfoRow label="Correo" value={sol.correo} />
          <InfoRow label="RFC" value={sol.rfc || sol.rfc_empresa} />
          <InfoRow label="Estado civil" value={sol.estado_civil} />
          <InfoRow label="Ingresos mensuales" value={fmt(sol.ingresos_mensuales || sol.ingresos_empresa)} />
          <InfoRow label="Tipo de ingresos" value={sol.tipo_ingresos} />
          <InfoRow label="Empresa" value={sol.empresa_labora || sol.razon_social} />
          <InfoRow label="Mascotas" value={sol.tiene_mascotas ? `Sí — ${sol.detalle_mascotas || ''}` : 'No'} />
        </div>
        <InfoRow label="Domicilio actual" value={sol.domicilio_actual} />
        <InfoRow label="Inmueble de interés" value={sol.inmueble_interes} />
        <InfoRow label="Uso del inmueble" value={sol.uso_inmueble} />

        <div style={{ ...st.divider, margin: '16px 0' }} />
        <div style={st.grid2}>
          <div>
            <label style={st.label}>Status de la solicitud</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={st.input}>
              <option value="pendiente">Pendiente</option>
              <option value="en_revision">En revisión</option>
              <option value="aprobado">Aprobado</option>
              <option value="rechazado">Rechazado</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={st.label}>Notas jurídicas internas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3}
            style={{ ...st.input, resize: 'vertical' }}
            placeholder="Observaciones del dictamen, notas de investigación..." />
        </div>

        {/* Documentos */}
        {(sol.doc_identificacion || sol.doc_comprobante_ingresos) && (
          <>
            <div style={{ ...st.divider, margin: '16px 0' }} />
            <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', margin: '0 0 10px' }}>Documentos</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sol.doc_identificacion && <DocChip label="Identificación" path={sol.doc_identificacion} />}
              {sol.doc_comprobante_ingresos && <DocChip label="Comprobante ingresos" path={sol.doc_comprobante_ingresos} />}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{ ...st.btn, ...st.btnGhost }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGreen }}>
            {saving ? 'Guardando...' : 'Guardar notas'}
          </button>
          {status === 'aprobado' && (
            <button onClick={onNuevoExp} style={{ ...st.btn, ...st.btnGold }}>+ Crear expediente</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Componentes helper ───────────────────────────────────
const FField = ({ label, value, onChange, type = 'text', placeholder }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={st.label}>{label}</label>
    <input type={type} value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={st.input} />
  </div>
)

const InfoRow = ({ label, value }) => (
  <div style={{ marginBottom: 12 }}>
    <p style={{ margin: 0, fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
    <p style={{ margin: '3px 0 0', fontSize: 14, color: value ? C.text : C.faint }}>{value || '—'}</p>
  </div>
)

const DocChip = ({ label, path }) => {
  const handleView = async () => {
    const { data } = await supabase.storage.from('poliza-docs').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  return (
    <button onClick={handleView} style={{ ...st.btn, ...st.btnGhost, fontSize: 12, padding: '6px 12px' }}>
      📄 {label}
    </button>
  )
}
