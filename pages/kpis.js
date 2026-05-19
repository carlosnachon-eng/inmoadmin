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
  'Ariannet': 'ari',
  'Angélica': 'angelica',
  'Iván': 'ivan',
  'Rosario': 'rosario',
  'Andrea': 'andrea',
  'Guillermo': 'guillermo',
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

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const email = session?.user?.email
  const nombre = ASESORES[email] || null
  const esAdmin = ADMINS.includes(email)
  const esAsesor = !!nombre

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session && esAsesor) {
      cargarRegistroHoy()
      cargarRanking()
    }
  }, [session])

  useEffect(() => {
    if (vistaRanking) {
      setAnimado(false)
      setTimeout(() => setAnimado(true), 100)
    }
  }, [vistaRanking])

  const cargarRegistroHoy = async () => {
    const { data } = await supabase.from('kpis_diarios').select('*').eq('email', email).eq('fecha', hoy).single()
    if (data) {
      setRegistroHoy(data)
      setForm({ citas_agendadas: data.citas_agendadas, citas_efectivas: data.citas_efectivas, citas_calificadas: data.citas_calificadas })
    }
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
    setKpis(kpisData || [])
    setCierres(cierresData || [])
  }

  const guardar = async () => {
    setGuardando(true)
    if (registroHoy) {
      await supabase.from('kpis_diarios').update(form).eq('id', registroHoy.id)
    } else {
      await supabase.from('kpis_diarios').insert({ ...form, fecha: hoy, asesor: nombre, email })
    }
    showToast('✓ Guardado')
    setGuardando(false)
    cargarRegistroHoy()
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

  const Counter = ({ label, field, color }) => (
    <div style={{ background: '#111', borderRadius: 14, padding: 20, border: `1px solid ${color}22` }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 14 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button onClick={() => setForm(f => ({ ...f, [field]: Math.max(0, f[field] - 1) }))}
          style={{ width: 48, height: 48, borderRadius: 12, border: '1px solid #333', background: '#0a0a0a', color: '#fff', fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>−</button>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 56, color, lineHeight: 1, letterSpacing: 2 }}>{form[field]}</div>
        <button onClick={() => setForm(f => ({ ...f, [field]: f[field] + 1 }))}
          style={{ width: 48, height: 48, borderRadius: 12, border: `1px solid ${color}`, background: color + '22', color, fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>+</button>
      </div>
    </div>
  )

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'monospace', letterSpacing: 4 }}>CARGANDO...</p>
    </div>
  )

  if (!session) return <Login />

  if (!esAsesor && !esAdmin) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', color: '#f0f0f0', fontFamily: 'monospace' }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>🚫</p>
        <p>SIN ACCESO</p>
        <p style={{ color: '#444', fontSize: 12, marginTop: 8 }}>{email}</p>
        <button onClick={() => supabase.auth.signOut()} style={{ marginTop: 20, background: '#222', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', cursor: 'pointer' }}>SALIR</button>
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
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #0a0a0a; }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .card-enter { animation: slideUp 0.35s ease forwards; }
          .card-enter:nth-child(1) { animation-delay: 0.05s; }
          .card-enter:nth-child(2) { animation-delay: 0.1s; }
          .card-enter:nth-child(3) { animation-delay: 0.15s; }
          .card-enter:nth-child(4) { animation-delay: 0.2s; }
          .card-enter:nth-child(5) { animation-delay: 0.25s; }
          .card-enter:nth-child(6) { animation-delay: 0.3s; }
        `}</style>
      </Head>

      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f0f0f0', fontFamily: "'Syne', sans-serif", maxWidth: 480, margin: '0 auto', padding: '24px 20px 40px' }}>

        {toast && (
          <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#00e676' : '#ff4444', color: toast.ok ? '#000' : '#fff', padding: '12px 24px', borderRadius: 100, fontWeight: 700, fontSize: 14, zIndex: 999, fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
            {toast.msg}
          </div>
        )}

        {!vistaRanking ? (
          <>
            {/* CAPTURA */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 3, color: '#fff', lineHeight: 1 }}>
                HOLA, <span style={{ color: '#00e676' }}>{nombre.toUpperCase()}</span>
              </div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#444', textTransform: 'capitalize', marginTop: 4, letterSpacing: 1 }}>{fechaDisplay}</div>
            </div>

            {registroHoy && (
              <div style={{ background: '#0a1a0a', border: '1px solid #00e67633', borderRadius: 10, padding: '10px 16px', marginBottom: 20, fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#00e676', letterSpacing: 1 }}>
                ✓ YA REGISTRASTE HOY — PUEDES ACTUALIZAR
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <Counter label="Citas agendadas" field="citas_agendadas" color="#00e676" />
              <Counter label="Citas efectivas" field="citas_efectivas" color="#ffab00" />
              <Counter label="Citas calificadas" field="citas_calificadas" color="#ff6b6b" />
            </div>

            <button onClick={guardar} disabled={guardando}
              style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: guardando ? '#222' : '#00e676', color: guardando ? '#555' : '#000', fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, fontWeight: 700, cursor: guardando ? 'not-allowed' : 'pointer', letterSpacing: 3, marginBottom: 10 }}>
              {guardando ? 'GUARDANDO...' : registroHoy ? 'ACTUALIZAR' : 'REGISTRAR DÍA'}
            </button>

            <button onClick={() => setVistaRanking(true)}
              style={{ width: '100%', padding: 14, borderRadius: 12, border: '1px solid #222', background: 'transparent', color: '#555', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', letterSpacing: 2 }}>
              🏆 VER RANKING DEL MES
            </button>

            {esAdmin && (
              <button onClick={() => window.location.href = '/kpis-dashboard'}
                style={{ width: '100%', marginTop: 8, padding: 12, borderRadius: 10, border: '1px solid #222', background: 'transparent', color: '#444', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer', letterSpacing: 1 }}>
                IR AL DASHBOARD →
              </button>
            )}

            <button onClick={() => supabase.auth.signOut()}
              style={{ width: '100%', marginTop: 8, padding: 12, borderRadius: 10, border: 'none', background: 'transparent', color: '#333', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer' }}>
              Cerrar sesión
            </button>
          </>
        ) : (
          <>
            {/* RANKING */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, color: '#fff' }}>RANKING <span style={{ color: '#00e676' }}>DEL MES</span></div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#444', letterSpacing: 2, marginTop: 2 }}>
                  {new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase()}
                </div>
              </div>
              <button onClick={() => setVistaRanking(false)}
                style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '8px 14px', color: '#555', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer', letterSpacing: 1 }}>
                ← VOLVER
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rankingData.map((a, i) => {
                const esTuyo = a.nombre === nombre
                const esPrimero = i === 0
                return (
                  <div key={a.nombre} className={animado ? 'card-enter' : ''} style={{ opacity: animado ? 1 : 0 }}>
                    <div style={{
                      background: esTuyo ? '#0a1520' : esPrimero ? '#0a1a0a' : '#111',
                      border: `1px solid ${esTuyo ? '#0066ff55' : esPrimero ? '#00e67633' : '#1a1a1a'}`,
                      borderRadius: 12,
                      padding: '14px 18px',
                      display: 'grid',
                      gridTemplateColumns: '44px 1fr auto',
                      gap: 14,
                      alignItems: 'center',
                      position: 'relative',
                      overflow: 'hidden',
                    }}>
                      {esTuyo && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #0066ff, transparent)' }} />}
                      {esPrimero && !esTuyo && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #00e676, transparent)' }} />}

                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: i < 3 ? 26 : 16 }}>{MEDALLAS[i]}</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#333', marginTop: 2 }}>#{i + 1}</div>
                      </div>

                      <div>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 2, color: esTuyo ? '#4d9fff' : esPrimero ? '#00e676' : '#f0f0f0' }}>
                          {a.nombre.toUpperCase()} {esTuyo && <span style={{ fontSize: 12, color: '#4d9fff55' }}>← TÚ</span>}
                        </div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#444', marginTop: 2 }}>
                          {a.citas_efectivas} citas efectivas
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, lineHeight: 1, color: a.operaciones > 0 ? (esPrimero ? '#00e676' : '#ffab00') : '#222', letterSpacing: 2 }}>{a.operaciones}</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#333', letterSpacing: 1 }}>CIERRES</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <button onClick={() => setVistaRanking(false)}
              style={{ width: '100%', marginTop: 20, padding: 14, borderRadius: 12, border: '1px solid #222', background: 'transparent', color: '#555', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', letterSpacing: 2 }}>
              ← VOLVER A CAPTURA
            </button>
          </>
        )}
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
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: 'https://app.emporioinmobiliario.com.mx/kpis' }
    })
    setLoading(false)
    setSent(true)
  }

  return (
    <>
      <Head>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 360, color: '#f0f0f0' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: 4, color: '#fff' }}>EMPORIO <span style={{ color: '#00e676' }}>KPIs</span></div>
            <p style={{ color: '#444', fontSize: 11, marginTop: 6, fontFamily: "'DM Mono', monospace", letterSpacing: 2 }}>ACCESO SOLO PARA EL EQUIPO</p>
          </div>
          {!sent ? (
            <>
              <input type="email" placeholder="tu@correo.com" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                style={{ width: '100%', background: '#111', border: '1px solid #222', borderRadius: 10, padding: '14px 16px', color: '#f0f0f0', fontFamily: "'DM Mono', monospace", fontSize: 14, boxSizing: 'border-box', marginBottom: 12, outline: 'none', letterSpacing: 1 }} />
              <button onClick={send} disabled={loading || !email}
                style={{ width: '100%', padding: 16, borderRadius: 12, border: 'none', background: '#00e676', color: '#000', fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 3, cursor: 'pointer', opacity: loading || !email ? 0.4 : 1 }}>
                {loading ? 'ENVIANDO...' : 'ENTRAR →'}
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', background: '#111', borderRadius: 14, padding: 28, border: '1px solid #1a1a1a' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📧</div>
              <p style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 2, marginBottom: 6 }}>REVISA TU CORREO</p>
              <p style={{ color: '#555', fontSize: 12, fontFamily: "'DM Mono', monospace" }}>{email}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
