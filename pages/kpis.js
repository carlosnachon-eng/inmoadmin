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

export default function KPIs() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [toast, setToast] = useState(null)
  const [registroHoy, setRegistroHoy] = useState(null)
  const [form, setForm] = useState({ citas_agendadas: 0, citas_efectivas: 0, citas_calificadas: 0 })

  const hoy = new Date().toISOString().split('T')[0]
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
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session && esAsesor) cargarRegistroHoy()
  }, [session])

  const cargarRegistroHoy = async () => {
    const { data } = await supabase
      .from('kpis_diarios')
      .select('*')
      .eq('email', email)
      .eq('fecha', hoy)
      .single()
    if (data) {
      setRegistroHoy(data)
      setForm({
        citas_agendadas: data.citas_agendadas,
        citas_efectivas: data.citas_efectivas,
        citas_calificadas: data.citas_calificadas,
      })
    }
  }

  const guardar = async () => {
    setGuardando(true)
    if (registroHoy) {
      await supabase.from('kpis_diarios').update(form).eq('id', registroHoy.id)
    } else {
      await supabase.from('kpis_diarios').insert({
        ...form, fecha: hoy, asesor: nombre, email
      })
    }
    showToast('✓ Guardado')
    setGuardando(false)
    cargarRegistroHoy()
  }

  const Counter = ({ label, field, color }) => (
    <div style={{ background: '#1a1a1a', borderRadius: 16, padding: 24, border: `1px solid ${color}22` }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <button onClick={() => setForm(f => ({ ...f, [field]: Math.max(0, f[field] - 1) }))}
          style={{ width: 48, height: 48, borderRadius: 12, border: `1px solid #333`, background: '#111', color: '#fff', fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 48, fontWeight: 700, color, lineHeight: 1 }}>{form[field]}</div>
        <button onClick={() => setForm(f => ({ ...f, [field]: f[field] + 1 }))}
          style={{ width: 48, height: 48, borderRadius: 12, border: `1px solid ${color}`, background: color + '22', color, fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      </div>
    </div>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#666', fontFamily: "'DM Mono', monospace" }}>Cargando...</p>
    </div>
  )

  if (!session) return <Login />

  if (!esAsesor && !esAdmin) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>🚫</p>
        <p style={{ color: '#fff', fontWeight: 700, marginBottom: 8 }}>Sin acceso</p>
        <p style={{ color: '#666', fontSize: 14 }}>{email}</p>
        <button onClick={() => supabase.auth.signOut()} style={{ marginTop: 20, background: '#333', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', cursor: 'pointer' }}>Cerrar sesión</button>
      </div>
    </div>
  )

  if (esAdmin && !esAsesor) {
    // Redirigir al dashboard
    if (typeof window !== 'undefined') window.location.href = '/kpis-dashboard'
    return null
  }

  const fechaDisplay = new Date(hoy + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <Head>
        <title>KPIs · {nombre}</title>
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#f0f0f0', fontFamily: "'Syne', sans-serif", maxWidth: 430, margin: '0 auto', padding: '24px 20px 40px' }}>

        {toast && (
          <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#00e676' : '#ff4444', color: toast.ok ? '#000' : '#fff', padding: '12px 24px', borderRadius: 100, fontWeight: 700, fontSize: 14, zIndex: 999 }}>
            {toast.msg}
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Emporio Inmobiliario</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>Hola, {nombre} 👋</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#555', textTransform: 'capitalize' }}>{fechaDisplay}</div>
        </div>

        {registroHoy && (
          <div style={{ background: '#1a2e1a', border: '1px solid #00e67633', borderRadius: 12, padding: '10px 16px', marginBottom: 20, fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#00e676' }}>
            ✓ Ya registraste hoy — puedes actualizar tus números
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          <Counter label="Citas agendadas" field="citas_agendadas" color="#00e676" />
          <Counter label="Citas efectivas" field="citas_efectivas" color="#ffab00" />
          <Counter label="Citas calificadas" field="citas_calificadas" color="#ff6b6b" />
        </div>

        <button onClick={guardar} disabled={guardando}
          style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: guardando ? '#333' : '#00e676', color: guardando ? '#666' : '#000', fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, cursor: guardando ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}>
          {guardando ? 'Guardando...' : registroHoy ? 'Actualizar' : 'Registrar día'}
        </button>

        {esAdmin && (
          <button onClick={() => window.location.href = '/kpis-dashboard'}
            style={{ width: '100%', marginTop: 10, padding: 14, borderRadius: 12, border: '1px solid #333', background: 'transparent', color: '#666', fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Ver dashboard del equipo →
          </button>
        )}

        <button onClick={() => supabase.auth.signOut()}
          style={{ width: '100%', marginTop: 10, padding: 12, borderRadius: 10, border: 'none', background: 'transparent', color: '#444', fontFamily: "'Syne', sans-serif", fontSize: 12, cursor: 'pointer' }}>
          Cerrar sesión
        </button>
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
      options: { shouldCreateUser: false, emailRedirectTo: 'https://app.emporioinmobiliario.com.mx/kpis' }
    })
    setLoading(false)
    setSent(true)
  }

  return (
    <>
      <Head>
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 360, fontFamily: "'Syne', sans-serif", color: '#f0f0f0' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px' }}>KPIs Emporio</h1>
            <p style={{ color: '#666', fontSize: 13, margin: 0, fontFamily: "'DM Mono', monospace" }}>Acceso solo para el equipo</p>
          </div>
          {!sent ? (
            <>
              <input type="email" placeholder="tu@correo.com" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: '14px 16px', color: '#f0f0f0', fontFamily: "'DM Mono', monospace", fontSize: 15, boxSizing: 'border-box', marginBottom: 12, outline: 'none' }} />
              <button onClick={send} disabled={loading || !email}
                style={{ width: '100%', padding: 16, borderRadius: 12, border: 'none', background: '#00e676', color: '#000', fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 800, cursor: 'pointer', opacity: loading || !email ? 0.5 : 1 }}>
                {loading ? 'Enviando...' : 'Entrar →'}
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', background: '#1a1a1a', borderRadius: 14, padding: 28 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📧</div>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Revisa tu correo</p>
              <p style={{ color: '#666', fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{email}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
