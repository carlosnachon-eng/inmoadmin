import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'

export default function FirmasDashboard() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [firmas, setFirmas] = useState([])
  const [filtro, setFiltro] = useState('activo')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) cargarFirmas()
  }, [session, filtro])

  async function cargarFirmas() {
    setLoading(true)
    const { data } = await supabase
      .from('firmas')
      .select('*, firma_etapas(*)')
      .eq('status', filtro)
      .order('created_at', { ascending: false })
    setFirmas(data || [])
    setLoading(false)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setLoginError('Correo o contrasena incorrectos')
      setLoginLoading(false)
      return
    }

    const { data: usuario } = await supabase
      .from('firmas_usuarios')
      .select('email')
      .eq('email', data.user.email)
      .maybeSingle()

    if (!usuario) {
      await supabase.auth.signOut()
      setLoginError('No tienes acceso a este modulo')
      setLoginLoading(false)
      return
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null)
  }

  const RESPONSABLE_LABELS = {
    ventas: 'Ventas',
    juridico: 'Juridico',
    administracion: 'Administracion (Majo)',
    direccion: 'Direccion',
  }

  if (authLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <p style={{ color: '#888' }}>Cargando...</p>
    </div>
  )

  if (!session) return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '380px', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ width: '160px', display: 'block', margin: '0 auto 1.5rem' }} />
        <h2 style={{ textAlign: 'center', color: '#1a3c5e', fontSize: '1.1rem', marginBottom: '1.5rem' }}>Coordinacion de Firmas</h2>
        <form onSubmit={handleLogin}>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#555' }}>Correo</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem', boxSizing: 'border-box' }} />
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#555' }}>Contrasena</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '1rem', boxSizing: 'border-box' }} />
          {loginError && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem' }}>{loginError}</p>}
          <button type="submit" disabled={loginLoading}
            style={{ width: '100%', padding: '0.75rem', background: '#1a3c5e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}>
            {loginLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: '900px', margin: '1rem auto', padding: '0 0.75rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.3rem', color: '#1a3c5e', margin: '0 0 4px' }}>Coordinacion de Firmas</h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#888' }}>{session.user.email}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link href="/firmas/nueva" style={{ background: '#1a3c5e', color: '#fff', padding: '0.6rem 1.25rem', borderRadius: '8px', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>
            + Nuevo expediente
          </Link>
          <button onClick={handleLogout} style={{ background: '#f3f4f6', color: '#555', border: 'none', padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>
            Salir
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[['activo', 'En proceso'], ['completado', 'Completados'], ['cancelado', 'Cancelados']].map(([v, l]) => (
          <button key={v} onClick={() => setFiltro(v)} style={{
            padding: '0.4rem 1rem', borderRadius: '20px', border: '2px solid',
            borderColor: filtro === v ? '#1a3c5e' : '#ddd',
            background: filtro === v ? '#1a3c5e' : '#fff',
            color: filtro === v ? '#fff' : '#555',
            fontSize: '0.85rem', cursor: 'pointer', fontWeight: filtro === v ? 600 : 400
          }}>{l}</button>
        ))}
      </div>

      {loading && <p style={{ color: '#888' }}>Cargando...</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {firmas.map(firma => {
          const etapas = firma.firma_etapas || []
          const completadas = etapas.filter(e => e.status === 'completada').length
          const total = etapas.filter(e => e.status !== 'no_aplica').length
          const pct = total > 0 ? Math.round((completadas / total) * 100) : 0
          const etapaActual = etapas.find(e => e.status === 'pendiente' || e.status === 'en_proceso')
          const horasSinMover = etapaActual ? (Date.now() - new Date(firma.updated_at)) / (1000 * 60 * 60) : 0
          const semaforo = firma.status === 'completado' ? '#22c55e' : horasSinMover > 24 ? '#ef4444' : horasSinMover > 12 ? '#f59e0b' : '#22c55e'

          return (
            <Link key={firma.id} href={`/firmas/${firma.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', borderRadius: '10px', padding: '1rem 1.25rem', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #eee', borderLeft: `4px solid ${semaforo}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '0.75rem', color: '#888' }}>
                      {firma.tipo} {firma.urgente ? '— URGENTE' : ''}
                    </p>
                    <p style={{ margin: 0, fontWeight: 600, color: '#1a3c5e', fontSize: '0.95rem' }}>{firma.titulo}</p>
                    {etapaActual && (
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#666' }}>
                        Etapa actual: {etapaActual.nombre} ({RESPONSABLE_LABELS[etapaActual.responsable]})
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontWeight: 700, color: '#1a3c5e', fontSize: '1rem' }}>{pct}%</p>
                    <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#aaa' }}>{completadas}/{total} etapas</p>
                  </div>
                </div>
                <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '5px', marginTop: '0.75rem' }}>
                  <div style={{ background: semaforo, width: `${pct}%`, height: '5px', borderRadius: '4px' }} />
                </div>
              </div>
            </Link>
          )
        })}
        {!loading && firmas.length === 0 && (
          <p style={{ color: '#aaa', textAlign: 'center', padding: '2rem' }}>No hay expedientes</p>
        )}
      </div>
    </div>
  )
}
