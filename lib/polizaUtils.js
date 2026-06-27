// ─── Colores ───────────────────────────────────────────────
export const C = {
  bg: '#f8f8f8', card: '#ffffff', border: '#e5e7eb', border2: '#e5e7eb',
  gold: '#b91c3c', goldLight: '#fff0f3', goldText: '#b91c3c',
  green: '#065f46', greenText: '#065f46', greenBg: '#f0fdf4',
  red: '#991b1b', redText: '#991b1b', redBg: '#fee2e2',
  blue: '#1e40af', blueText: '#1e40af', blueBg: '#dbeafe',
  text: '#374151', muted: '#9ca3af', faint: '#d1d5db', white: '#FFFFFF',
}

export const STATUS_LABELS = {
  borrador:    { label: 'Borrador',    color: C.muted,     bg: '#e5e7eb' },
  activo:      { label: 'Activo',      color: C.greenText, bg: C.greenBg },
  vencido:     { label: 'Vencido',     color: C.redText,   bg: C.redBg },
  cancelado:   { label: 'Cancelado',   color: '#6b7280',   bg: '#f3f4f6' },
  // compatibilidad con registros anteriores
  firmado:     { label: 'Activo',      color: C.greenText, bg: C.greenBg },
  completo:    { label: 'Activo',      color: C.greenText, bg: C.greenBg },
  pendiente:   { label: 'Borrador',    color: C.muted,     bg: '#e5e7eb' },
  en_revision: { label: 'Borrador',    color: C.muted,     bg: '#e5e7eb' },
}

export const Badge = ({ status }) => {
  const bs = STATUS_LABELS[status] || { label: status, color: C.muted, bg: '#1A1A1A' }
  return (
    <span style={{ background: bs.bg, color: bs.color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: '0.3px' }}>
      {bs.label}
    </span>
  )
}

export const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'
export const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── Número a letra ────────────────────────────────────────
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

export function numeroALetra(n) {
  if (!n || isNaN(n)) return ''
  const entero = Math.floor(n), cents = Math.round((n - entero) * 100)
  let r = ''
  if (entero === 0) r = 'CERO'
  else if (entero < 1000) r = cientos(entero)
  else if (entero < 2000) r = 'MIL ' + (entero % 1000 > 0 ? cientos(entero % 1000) : '')
  else r = cientos(Math.floor(entero / 1000)) + ' MIL ' + (entero % 1000 > 0 ? cientos(entero % 1000) : '')
  return r.trim() + ' ' + String(cents).padStart(2, '0') + '/100 M.N.'
}

// ─── Calcular 12 fechas de pagarés ────────────────────────
export function calcularPagares(fechaInicio) {
  if (!fechaInicio) return {}
  const dates = {}
  const base = new Date(fechaInicio + 'T12:00:00')
  for (let i = 0; i < 12; i++) {
    const d = new Date(base)
    d.setMonth(d.getMonth() + i)
    dates[`fecha_pagare_${i + 1}`] = d.toISOString().split('T')[0]
  }
  return dates
}

// ─── Calcular fecha vigencia ───────────────────────────────
export function calcularFechaVigencia(fechaInicio, meses) {
  if (!fechaInicio) return ''
  const d = new Date(fechaInicio + 'T12:00:00')
  d.setMonth(d.getMonth() + (parseInt(meses) || 12))
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// ─── Correos permitidos ───────────────────────────────────
export const CORREOS_PERMITIDOS = [
  'juridico@emporioinmobiliario.mx',
  'carlos.nachon@emporioinmobiliario.mx',
]

// ─── Helpers de UI ────────────────────────────────────────
export const InfoRow = ({ label, value }) => (
  <div style={{ marginBottom: 12 }}>
    <p style={{ margin: 0, fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</p>
    <p style={{ margin: '3px 0 0', fontSize: 14, color: value ? C.text : C.faint }}>{value || '—'}</p>
  </div>
)

export const DocChipB64 = ({ label, data }) => {
  const handleView = () => {
    const win = window.open()
    win.document.write(`<iframe src="${data}" width="100%" height="100%" style="border:none"></iframe>`)
  }
  return (
    <button onClick={handleView} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer', marginRight: 6, marginBottom: 6 }}>
      📄 {label}
    </button>
  )
}

// ─── Estilos base ─────────────────────────────────────────
export const st = {
  page: { minHeight: '100vh', background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif", color: C.text },
  header: { background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 20, height: 60 },
  logo: { height: 32, objectFit: 'contain' },
  headerTitle: { fontSize: 15, fontWeight: 700, color: C.text },
  headerSub: { fontSize: 12, color: C.muted },
  nav: { display: 'flex', gap: 4, marginLeft: 32 },
  navBtn: { padding: '6px 16px', borderRadius: 8, border: 'none', background: 'transparent', color: C.muted, fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  navBtnActive: { background: C.goldLight, color: C.goldText },
  main: { maxWidth: 1100, margin: '0 auto', padding: '28px 20px' },
  sectionTitle: { fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 4px', fontFamily: 'Georgia, serif' },
  sectionSub: { fontSize: 13, color: C.muted, margin: '0 0 24px' },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' },
  tableHead: { background: '#f9fafb', borderBottom: `1px solid ${C.border}` },
  th: { padding: '12px 16px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' },
  td: { padding: '14px 16px', fontSize: 13, borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle' },
  trHover: { cursor: 'pointer', transition: 'background 0.15s' },
  btn: { padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.15s' },
  btnGold: { background: C.gold, color: '#fff' },
  btnGhost: { background: 'transparent', border: `1px solid ${C.border2}`, color: C.muted },
  btnGreen: { background: C.green, color: '#ffffff' },
  btnRed: { background: C.red, color: C.redText },
  input: { width: '100%', background: '#ffffff', border: `1px solid ${C.border2}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: '0.3px' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '40px 16px' },
  modalCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: 720, padding: 32 },
  divider: { height: 1, background: C.border, margin: '24px 0' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 },
  emptyState: { textAlign: 'center', padding: '60px 20px', color: C.muted },
}
