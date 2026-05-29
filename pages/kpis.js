import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const ASESORES = {
  'ariannet81@gmail.com': 'Ariannet',
  'angelicamomox@gmail.com': 'Angélica',
  'rddd298@gmail.com': 'Rosario',
  'ivanmtzco@gmail.com': 'Iván',
  'nextelmoto2@gmail.com': 'Andrea',
  'guillermo@emporioinmobiliario.com.mx': 'Guillermo',
}

const ADMINS = [
  'carlos.nachon@emporioinmobiliario.mx',
  'guillermo@emporioinmobiliario.com.mx',
]

const VENDEDOR_MAP = {
  'Ariannet': 'ari', 'Angélica': 'angelica', 'Iván': 'ivan',
  'Rosario': 'rosario', 'Andrea': 'andrea', 'Guillermo': 'guillermo',
}

const MEDALLAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣']
const NOMBRES_LISTA = ['Ariannet', 'Angélica', 'Rosario', 'Iván', 'Andrea', 'Guillermo']

export default function KPIs() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [toast, setToast] = useState(null)
  const [registroHoy, setRegistroHoy] = useState(null)
  const [form, setForm] = useState({ citas_agendadas: 0, citas_efectivas: 0, citas_calificadas: 0 })
  const [vistaRanking, setVistaRanking] = useState(false)
  const [kpis, setKpis] = useState([])
  const [cierres, setCierres] = useState([])
  const [animado, setAnimado] = useState(false)

  // Fecha basada en servidor Supabase para evitar desfase por zona horaria del dispositivo
  const [hoy, setHoy] = useState('')
  useEffect(() => {
    // Obtener hora actual del servidor de Supabase
    supabase.rpc('get_fecha_mexico').then(({ data }) => {
      if (data) setHoy(data)
      else {
        // Fallback: usar hora local con zona México
        setHoy(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }))
      }
    })
  }, [])
  const email = session?.user?.email
  const nombre = ASESORES[email] || null
  const esAdmin = ADMINS.includes(email)
  const esAsesor = !!nombre

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
  if (session && esAsesor && hoy) { cargarRegistroHoy(); cargarRanking() }
}, [session, hoy])

  useEffect(() => {
    if (vistaRanking) { setAnimado(false); setTimeout(() => setAnimado(true), 100) }
  }, [vistaRanking])

  const cargarRegistroHoy = async () => {
    const { data } = await supabase.from('kpis_diarios').select('*').eq('email', email).eq('fecha', hoy).single()
    if (data) { setRegistroHoy(data); setForm({ citas_agendadas: data.citas_agendadas, citas_efectivas: data.citas_efectivas, citas_calificadas: data.citas_calificadas }) }
  }

  const cargarRanking = async () => {
    const anio = new Date().getFullYear()
    const mes = new Date().getMonth() + 1
    const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0).toISOString().split('T')[0]
    const [{ data: kpisData }, { data: cierresData }] = await Promise.all([
      supabase.from('kpis_diarios').select('*').gte('fecha', inicio).lte('fecha', fin),
      supabase.from('cierres').select('vendedor, comision').gte('fecha_cierre', inicio).lte('fecha_cierre', fin),
    ])
    setKpis(kpisData || []); setCierres(cierresData || [])
  }

  const guardar = async () => {
    setGuardando(true)
    if (registroHoy) { await supabase.from('kpis_diarios').update(form).eq('id', registroHoy.id) }
    else { await supabase.from('kpis_diarios').insert({ ...form, fecha: hoy, asesor: nombre, email }) }
    showToast('✓ Guardado'); setGuardando(false); cargarRegistroHoy()
  }

  const statsAsesor = (n) => {
    const registros = kpis.filter(k => k.asesor === n)
    const cierresAsesor = cierres.filter(c => (c.vendedor || '').toLowerCase() === (VENDEDOR_MAP[n] || n.toLowerCase()))
    return {
      citas_efectivas: registros.reduce((a, k) => a + (k.citas_efectivas || 0), 0),
      operaciones: cierresAsesor.length,
      ingresos: cierresAsesor.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0),
    }
  }

  const rankingData = NOMBRES_LISTA
    .map(n => ({ nombre: n, ...statsAsesor(n) }))
    .sort((a, b) => b.operaciones - a.operaciones || b.ingresos - a.ingresos)

  const Counter = ({ label, field, color, bg }) => (
    <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: `1px solid ${color}33` }}>
      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14, fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button onClick={() => setForm(f => ({ ...f, [field]: Math.max(0, f[field] - 1) }))}
          style={{ width: 48, height: 48, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f8f8f8', color: '#4a4a4a', fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
        <div style={{ fontSize: 64, fontWeight: 900, color, lineHeight: 1 }}>{form[field]}</div>
        <button onClick={() => setForm(f => ({ ...f, [field]: f[field] + 1 }))}
          style={{ width: 48, height: 48, borderRadius: 12, border: `1px solid ${color}`, background: bg, color, fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      </div>
    </div>
  )

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  )

  if (!session) return <Login />

  if (!esAsesor && !esAdmin) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <div style={{ textAlign: 'center', background: '#fff', padding: 40, borderRadius: 16, border: '1px solid #e5e7eb' }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, marginBottom: 16 }} />
        <p style={{ fontSize: 16, fontWeight: 700, color: '#4a4a4a', marginBottom: 8 }}>Sin acceso</p>
        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>{email}</p>
        <button onClick={() => supabase.auth.signOut()} style={{ background: '#b91c3c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 700 }}>Salir</button>
      </div>
    </div>
  )

  if (esAdmin && !esAsesor) {
    if (typeof window !== 'undefined') window.location.href = '/kpis-dashboard'
    return null
  }

  const fechaDisplay = new Date(hoy + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <Head>
        <title>KPIs · {nombre}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } } .card-enter { animation: slideUp 0.35s ease forwards; }`}</style>
      </Head>

      <div style={{ minHeight: '100vh', background: '#f8f8f8', fontFamily: 'system-ui, sans-serif' }}>
        {toast && (
          <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#065f46' : '#b91c3c', color: '#fff', padding: '12px 24px', borderRadius: 100, fontWeight: 700, fontSize: 14, zIndex: 999 }}>
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 20px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 32, objectFit: 'contain' }} />
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#b91c3c' }}>Hola, {nombre}</p>
              <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', textTransform: 'capitalize' }}>{fechaDisplay}</p>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>
          {!vistaRanking ? (
            <>
              {registroHoy && (
                <div style={{ background: '#f0fdf4', border: '1px solid #6ee7b7', borderRadius: 10, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
                  ✓ Ya registraste hoy — puedes actualizar
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Counter label="Citas agendadas" field="citas_agendadas" color="#065f46" bg="#f0fdf4" />
                <Counter label="Citas efectivas" field="citas_efectivas" color="#92400e" bg="#fffbeb" />
                <Counter label="Citas calificadas" field="citas_calificadas" color="#b91c3c" bg="#fff0f3" />
              </div>

              <button onClick={guardar} disabled={guardando}
                style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: guardando ? '#e5e7eb' : '#b91c3c', color: guardando ? '#9ca3af' : '#fff', fontSize: 16, fontWeight: 800, cursor: guardando ? 'not-allowed' : 'pointer', marginBottom: 10, letterSpacing: 1 }}>
                {guardando ? 'Guardando...' : registroHoy ? 'Actualizar registro' : 'Registrar día'}
              </button>

              <button onClick={() => setVistaRanking(true)}
                style={{ width: '100%', padding: 14, borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', color: '#9ca3af', fontSize: 13, cursor: 'pointer', marginBottom: 8, fontWeight: 600 }}>
                🏆 Ver ranking del mes
              </button>

              {esAdmin && (
                <button onClick={() => window.location.href = '/kpis-dashboard'}
                  style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>
                  Ir al dashboard admin →
                </button>
              )}

              <button onClick={() => supabase.auth.signOut()}
                style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: 'transparent', color: '#d1d5db', fontSize: 12, cursor: 'pointer' }}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#4a4a4a' }}>🏆 Ranking del mes</h2>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af', textTransform: 'capitalize' }}>{new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}</p>
                </div>
                <button onClick={() => setVistaRanking(false)}
                  style={{ background: '#f8f8f8', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
                  ← Volver
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rankingData.map((a, i) => {
                  const esTuyo = a.nombre === nombre
                  const esPrimero = i === 0
                  return (
                    <div key={a.nombre} className={animado ? 'card-enter' : ''} style={{ opacity: animado ? 1 : 0 }}>
                      <div style={{ background: esTuyo ? '#eff6ff' : esPrimero ? '#fff0f3' : '#fff', border: `1px solid ${esTuyo ? '#93c5fd' : esPrimero ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 12, padding: '14px 18px', display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 14, alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
                        {esTuyo && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#3b82f6' }} />}
                        {esPrimero && !esTuyo && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#b91c3c' }} />}
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: i < 3 ? 26 : 16 }}>{MEDALLAS[i]}</div>
                          <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>#{i + 1}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: esTuyo ? '#1d4ed8' : esPrimero ? '#b91c3c' : '#4a4a4a' }}>
                            {a.nombre} {esTuyo && <span style={{ fontSize: 11, color: '#93c5fd' }}>← tú</span>}
                          </div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{a.citas_efectivas} citas efectivas</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: a.operaciones > 0 ? (esPrimero ? '#b91c3c' : '#7c3aed') : '#e5e7eb' }}>{a.operaciones}</div>
                          <div style={{ fontSize: 9, color: '#9ca3af' }}>CIERRES</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <button onClick={() => setVistaRanking(false)}
                style={{ width: '100%', marginTop: 20, padding: 14, borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', color: '#9ca3af', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                ← Volver a captura
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const send = async () => {
    setLoading(true)
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: 'https://app.emporioinmobiliario.com.mx/kpis' } })
    setLoading(false); setSent(true)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 56, objectFit: 'contain', marginBottom: 24 }} />
      <div style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: 32, border: '1px solid #e5e7eb', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#4a4a4a', textAlign: 'center' }}>Sistema de KPIs</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>Acceso solo para el equipo Emporio</p>
        {!sent ? (
          <>
            <input type="email" placeholder="tu@correo.com" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px', fontSize: 14, boxSizing: 'border-box', marginBottom: 12, outline: 'none', color: '#374151' }} />
            <button onClick={send} disabled={loading || !email}
              style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: '#b91c3c', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: loading || !email ? 0.5 : 1 }}>
              {loading ? 'Enviando...' : 'Enviar enlace →'}
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📧</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: '#4a4a4a', marginBottom: 6 }}>Revisa tu correo</p>
            <p style={{ color: '#9ca3af', fontSize: 13 }}>{email}</p>
          </div>
        )}
      </div>
    </div>
  )
}
