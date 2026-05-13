import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0 })

const CATS_GASTO = [
  { emoji: '🏠', label: 'Renta' },
  { emoji: '🛒', label: 'Súper' },
  { emoji: '🚗', label: 'BYD' },
  { emoji: '🧹', label: 'Muchacha' },
  { emoji: '🎓', label: 'Colegiatura' },
  { emoji: '👨‍👧', label: 'Pensión' },
  { emoji: '🎉', label: 'Diversión' },
  { emoji: '⚽', label: 'Deportes' },
  { emoji: '💡', label: 'Luz' },
  { emoji: '🔥', label: 'Gas' },
  { emoji: '📡', label: 'Internet' },
  { emoji: '🛡️', label: 'Seg Autos' },
  { emoji: '🏥', label: 'SGMM' },
  { emoji: '🌿', label: 'Jardinero' },
  { emoji: '👤', label: 'Ismael' },
  { emoji: '👤', label: 'Ernesto' },
  { emoji: '💅', label: 'Belleza' },
  { emoji: '👔', label: 'Carlos personal' },
  { emoji: '👗', label: 'Ivonne personal' },
  { emoji: '💧', label: 'Agua' },
  { emoji: '🔧', label: 'Mant. casa' },
  { emoji: '🔩', label: 'Mant. autos' },
  { emoji: '📦', label: 'Gastos extra' },
  { emoji: '•••', label: 'Otro' },
]

const CATS_INGRESO = [
  { emoji: '💼', label: 'Sueldo Carlos' },
  { emoji: '💼', label: 'Sueldo Ivonne' },
  { emoji: '🏡', label: 'Cierre comisión' },
  { emoji: '📋', label: 'Póliza' },
  { emoji: '🏢', label: 'Administración' },
  { emoji: '🔧', label: 'Mantenimiento' },
  { emoji: '💵', label: 'Otro ingreso' },
]

const PRESUPUESTO = 181350

export default function Finanzas() {
  const [vista, setVista] = useState('dashboard')
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [tipo, setTipo] = useState('gasto')
  const [cat, setCat] = useState('')
  const [monto, setMonto] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [filtro, setFiltro] = useState('todo')
  const [toast, setToast] = useState(null)

  const mesLabel = () => new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase()

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 2500)
  }

  const cargar = async () => {
    setLoading(true)
    const now = new Date()
    const inicio = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const { data } = await supabase
      .from('gastos_personales')
      .select('*')
      .gte('fecha', inicio)
      .order('created_at', { ascending: false })
    setMovimientos(data || [])
    setLoading(false)
  }

  useEffect(() => { cargar() }, [])
  useEffect(() => { if (vista === 'dashboard') cargar() }, [vista])

  const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0)
  const gastos = movimientos.filter(m => m.tipo === 'gasto').reduce((a, m) => a + Number(m.monto), 0)
  const balance = ingresos - gastos
  const pct = Math.min((gastos / PRESUPUESTO) * 100, 100)
  const barColor = pct > 85 ? '#ff4444' : pct > 60 ? '#ffab00' : '#00e676'

  const listaFiltrada = movimientos.filter(m => filtro === 'todo' ? true : m.tipo === filtro)

  const guardar = async () => {
    if (!cat) { showToast('Selecciona una categoría', true); return }
    if (!monto || parseFloat(monto) <= 0) { showToast('Ingresa un monto válido', true); return }
    setGuardando(true)
    const { error } = await supabase.from('gastos_personales').insert({
      tipo, categoria: cat, monto: parseFloat(monto),
      notas: notas || null,
      fecha: new Date().toISOString().split('T')[0]
    })
    if (error) { showToast('Error al guardar', true) }
    else {
      showToast(tipo === 'gasto' ? 'Gasto registrado ✓' : 'Ingreso registrado ✓')
      setMonto(''); setNotas(''); setCat('')
      setTimeout(() => setVista('dashboard'), 800)
    }
    setGuardando(false)
  }

  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este movimiento?')) return
    await supabase.from('gastos_personales').delete().eq('id', id)
    setMovimientos(prev => prev.filter(m => m.id !== id))
  }

  const st = {
    page: { background: '#0f0f0f', minHeight: '100vh', maxWidth: 430, margin: '0 auto', color: '#f0f0f0', fontFamily: "'Syne', sans-serif", paddingBottom: 80 },
    header: { padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    h1: { fontSize: 22, fontWeight: 800, letterSpacing: -0.5 },
    mes: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#666', textTransform: 'uppercase' },
    card: { background: '#1a1a1a', borderRadius: 14, padding: 16, border: '1px solid #2a2a2a' },
    cardLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 },
    resumen: { padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
    tabs: { display: 'flex', gap: 8, padding: '0 20px 14px' },
    tab: (active) => ({ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid ' + (active ? '#00e676' : '#2a2a2a'), background: active ? '#00e676' : 'transparent', color: active ? '#000' : '#666', fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
    item: { background: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 8, border: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    catGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14, maxHeight: 280, overflowY: 'auto' },
    catBtn: (sel) => ({ padding: '10px 8px', borderRadius: 10, border: '1px solid ' + (sel ? '#00e676' : '#2a2a2a'), background: sel ? 'rgba(0,230,118,0.1)' : '#1a1a1a', color: sel ? '#00e676' : '#f0f0f0', fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }),
    input: { width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, color: '#f0f0f0', fontFamily: "'DM Mono', monospace", fontSize: 18, padding: '14px 16px', outline: 'none', marginBottom: 10 },
    btnGuardar: { width: '100%', padding: 16, borderRadius: 12, border: 'none', background: '#00e676', color: '#000', fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, cursor: 'pointer', opacity: guardando ? 0.5 : 1 },
    bottomNav: { position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#1a1a1a', borderTop: '1px solid #2a2a2a', display: 'flex', padding: '8px 0 20px', zIndex: 100 },
    navBtn: (active) => ({ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: active ? '#00e676' : '#666', fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: 6 }),
    tipoToggle: { display: 'flex', gap: 8, marginBottom: 14 },
    tipoBtn: (t, active) => ({ flex: 1, padding: 12, borderRadius: 10, border: '1px solid ' + (active ? (t === 'gasto' ? '#ff4444' : '#00e676') : '#2a2a2a'), background: active ? (t === 'gasto' ? '#ff4444' : '#00e676') : 'transparent', color: active ? (t === 'gasto' ? '#fff' : '#000') : '#666', fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer' }),
  }

  return (
    <>
      <Head>
        <title>Finanzas · Carlos</title>
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
      </Head>

      <div style={st.page}>
        {/* HEADER */}
        <div style={st.header}>
          <div>
            <div style={st.h1}>💰 Finanzas</div>
            <div style={st.mes}>{mesLabel()}</div>
          </div>
        </div>

        {/* TOAST */}
        {toast && (
          <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: toast.error ? '#ff4444' : '#00e676', color: toast.error ? '#fff' : '#000', padding: '12px 24px', borderRadius: 100, fontWeight: 700, fontSize: 14, zIndex: 999, whiteSpace: 'nowrap' }}>
            {toast.msg}
          </div>
        )}

        {/* DASHBOARD */}
        {vista === 'dashboard' && (
          <>
            <div style={st.resumen}>
              <div style={st.card}>
                <span style={st.cardLabel}>Ingresos</span>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, color: '#00e676' }}>{fmt(ingresos)}</div>
              </div>
              <div style={st.card}>
                <span style={st.cardLabel}>Gastos</span>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, color: '#ff4444' }}>{fmt(gastos)}</div>
              </div>
              <div style={{ ...st.card, gridColumn: '1/-1' }}>
                <span style={st.cardLabel}>Balance del mes</span>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, color: balance >= 0 ? '#00e676' : '#ff4444' }}>{fmt(balance)}</div>
                <div style={{ marginTop: 10, height: 6, background: '#2a2a2a', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', borderRadius: 99, background: barColor, transition: 'width 0.5s' }} />
                </div>
              </div>
              <div style={{ ...st.card, gridColumn: '1/-1' }}>
                <span style={st.cardLabel}>Presupuesto mensual</span>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, color: '#ffab00' }}>{fmt(PRESUPUESTO)}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#666', marginTop: 4 }}>
                  Gastado: {fmt(gastos)} · Disponible: {fmt(Math.max(PRESUPUESTO - gastos, 0))}
                </div>
              </div>
            </div>

            <div style={st.tabs}>
              {['todo', 'gasto', 'ingreso'].map((f, i) => (
                <button key={f} style={st.tab(filtro === f)} onClick={() => setFiltro(f)}>
                  {['Todo', 'Gastos', 'Ingresos'][i]}
                </button>
              ))}
            </div>

            <div style={{ padding: '0 20px 100px' }}>
              {loading ? (
                <div style={{ color: '#666', textAlign: 'center', padding: 40, fontFamily: "'DM Mono', monospace", fontSize: 13 }}>Cargando...</div>
              ) : listaFiltrada.length === 0 ? (
                <div style={{ color: '#666', textAlign: 'center', padding: 40, fontFamily: "'DM Mono', monospace", fontSize: 13 }}>Sin movimientos</div>
              ) : listaFiltrada.map(m => (
                <div key={m.id} style={st.item}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{m.categoria}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#666' }}>
                      {new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      {m.notas ? ' · ' + m.notas : ''}
                    </div>
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, color: m.tipo === 'gasto' ? '#ff4444' : '#00e676' }}>
                    {m.tipo === 'gasto' ? '-' : '+'}{fmt(m.monto)}
                  </div>
                  <button onClick={() => eliminar(m.id)} style={{ background: 'none', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer', padding: '4px 8px', marginLeft: 8 }}>×</button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* REGISTRAR */}
        {vista === 'registrar' && (
          <div style={{ padding: '20px 20px 100px' }}>
            <div style={st.tipoToggle}>
              <button style={st.tipoBtn('gasto', tipo === 'gasto')} onClick={() => { setTipo('gasto'); setCat('') }}>- Gasto</button>
              <button style={st.tipoBtn('ingreso', tipo === 'ingreso')} onClick={() => { setTipo('ingreso'); setCat('') }}>+ Ingreso</button>
            </div>

            <div style={st.catGrid}>
              {(tipo === 'gasto' ? CATS_GASTO : CATS_INGRESO).map(c => (
                <button key={c.label} style={st.catBtn(cat === c.label)} onClick={() => setCat(c.label)}>
                  <span style={{ fontSize: 16 }}>{c.emoji}</span>{c.label}
                </button>
              ))}
            </div>

            <input
              type="number" inputMode="decimal" placeholder="$0.00"
              value={monto} onChange={e => setMonto(e.target.value)}
              style={st.input}
            />
            <input
              type="text" placeholder="Nota (opcional)"
              value={notas} onChange={e => setNotas(e.target.value)}
              style={st.input}
            />
            <button style={st.btnGuardar} onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        )}

        {/* BOTTOM NAV */}
        <div style={st.bottomNav}>
          <button style={st.navBtn(vista === 'dashboard')} onClick={() => setVista('dashboard')}>
            <span style={{ fontSize: 22 }}>📊</span>Dashboard
          </button>
          <button style={st.navBtn(vista === 'registrar')} onClick={() => setVista('registrar')}>
            <span style={{ fontSize: 22 }}>➕</span>Registrar
          </button>
        </div>
      </div>
    </>
  )
}
