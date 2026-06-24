import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Roles que registran sus propias citas en KPIs (incluye a Guillermo,
// que aunque es Gerente, también captura sus propias citas como
// cualquier asesor — así era el comportamiento original).
const ROLES_QUE_REGISTRAN_KPIS = ['asesor', 'gerente_ventas']

// Roles con acceso de administrador dentro de KPIs (ven el botón de
// "Ver Dashboard"). Antes era una lista de correos sueltos.
const ROLES_ADMIN_KPIS = ['admin', 'gerente_ventas']

// Nombres reales como respaldo mientras profiles.full_name esté vacío
// para alguien (lo ideal es llenarlo en la base de datos directamente).
const NOMBRES_CONOCIDOS = {
  'ariannet81@gmail.com': 'Ariannet',
  'angelicamomox@gmail.com': 'Angélica',
  'rddd298@gmail.com': 'Rosario',
  'ivanmtzco@gmail.com': 'Iván',
  'nextelmoto2@gmail.com': 'Andrea',
  'guillermo@emporioinmobiliario.com.mx': 'Guillermo',
  'islas.amanda111@gmail.com': 'Amanda',
}

const VENDEDOR_MAP = {
  'Ariannet': 'ari', 'Angélica': 'angelica', 'Iván': 'ivan',
  'Rosario': 'rosario', 'Andrea': 'andrea', 'Guillermo': 'guillermo', 'Amanda': 'amanda',
}

const MEDALLAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣']
const META_INGRESOS = 90000

const calcularMetaCitas = (anio, mes) => {
  const diasEnMes = new Date(anio, mes, 0).getDate()
  let domingos = 0
  for (let d = 1; d <= diasEnMes; d++) {
    if (new Date(anio, mes - 1, d).getDay() === 0) domingos++
  }
  return (diasEnMes - domingos) * 2
}

const fmt = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })

export default function KPIs() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [registroHoy, setRegistroHoy] = useState(null)
  const [form, setForm] = useState({ citas_agendadas: 0, citas_efectivas: 0, citas_calificadas: 0 })
  const [vistaRanking, setVistaRanking] = useState(false)
  const [kpis, setKpis] = useState([])
  const [cierres, setCierres] = useState([])
  const [checadas, setChecadas] = useState([])
  const [animado, setAnimado] = useState(false)
  const [hoy, setHoy] = useState('')

  useEffect(() => {
    supabase.rpc('get_fecha_mexico').then(({ data }) => {
      if (data) setHoy(data)
      else setHoy(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }))
    })
  }, [])

  const email = session?.user?.email

  // Perfil real, cargado de profiles en vez de la lista hardcodeada ASESORES.
  const [perfilDb, setPerfilDb] = useState(null)
  const [perfilCargado, setPerfilCargado] = useState(false)
  useEffect(() => {
    if (!session) { setPerfilCargado(true); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { setPerfilDb(data); setPerfilCargado(true) })
  }, [session])

  const nombre = perfilDb && ROLES_QUE_REGISTRAN_KPIS.includes(perfilDb.role_id)
    ? (perfilDb.full_name || NOMBRES_CONOCIDOS[perfilDb.email] || perfilDb.email)
    : null
  const esAdmin = ROLES_ADMIN_KPIS.includes(perfilDb?.role_id)
  const esAsesor = !!nombre

  // Lista de nombres de todos los que registran KPIs (para el ranking),
  // cargada de profiles en vez de NOMBRES_LISTA hardcodeada.
  const [listaAsesores, setListaAsesores] = useState([])
  useEffect(() => {
    supabase.from('profiles').select('email, full_name, role_id').eq('active', true)
      .then(({ data }) => {
        const asesores = (data || []).filter(p => ROLES_QUE_REGISTRAN_KPIS.includes(p.role_id))
        setListaAsesores(asesores.map(p => p.full_name || NOMBRES_CONOCIDOS[p.email] || p.email))
      })
  }, [])
  const NOMBRES_LISTA = listaAsesores

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session && esAsesor && hoy) { calcularYGuardarKpisDelDia(); cargarRanking() }
  }, [session, hoy, esAsesor, perfilDb?.id])

  useEffect(() => {
    if (vistaRanking) { setAnimado(false); setTimeout(() => setAnimado(true), 100) }
  }, [vistaRanking])

  // Antes: el asesor tecleaba estos 3 números a mano. Ahora se calculan
  // automáticamente a partir de sus citas reales del día (módulo
  // Clientes), y se guardan en kpis_diarios de forma transparente — el
  // ranking, las metas y el dashboard admin siguen leyendo de la misma
  // tabla de siempre, sin que haya que tocar esa parte del sistema.
  const calcularYGuardarKpisDelDia = async () => {
    if (!perfilDb?.id) return;
    const inicioDia = `${hoy}T00:00:00`;
    const finDia = `${hoy}T23:59:59`;
    const { data: citasHoy } = await supabase
      .from('citas')
      .select('estado')
      .eq('asesor_id', perfilDb.id)
      .gte('fecha_hora', inicioDia)
      .lte('fecha_hora', finDia);

    const lista = citasHoy || [];
    const calculado = {
      citas_agendadas: lista.length,
      citas_efectivas: lista.filter(c => c.estado === 'efectiva' || c.estado === 'calificada').length,
      citas_calificadas: lista.filter(c => c.estado === 'calificada').length,
    };

    setForm(calculado);

    const { data: existente } = await supabase.from('kpis_diarios').select('id').eq('email', email).eq('fecha', hoy).maybeSingle();
    if (existente) {
      await supabase.from('kpis_diarios').update(calculado).eq('id', existente.id);
      setRegistroHoy({ ...existente, ...calculado });
    } else {
      const { data: nuevo } = await supabase.from('kpis_diarios').insert({ ...calculado, fecha: hoy, asesor: nombre, email }).select().single();
      setRegistroHoy(nuevo);
    }
  };

  const cargarRanking = async () => {
    const anio = new Date().getFullYear()
    const mes = new Date().getMonth() + 1
    const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0).toISOString().split('T')[0]
    const [{ data: kpisData }, { data: cierresData }, { data: checadasData }] = await Promise.all([
      supabase.from('kpis_diarios').select('*').gte('fecha', inicio).lte('fecha', fin),
      supabase.from('cierres').select('vendedor, comision').gte('fecha_cierre', inicio).lte('fecha_cierre', fin),
      supabase.from('checadas').select('*').eq('email', email).gte('fecha', inicio).lte('fecha', fin),
    ])
    setKpis(kpisData || [])
    setCierres(cierresData || [])
    setChecadas(checadasData || [])
  }

  // La función "guardar" manual ya no existe — los contadores se calculan
  // y guardan automáticamente en calcularYGuardarKpisDelDia(), a partir de
  // las citas capturadas en el módulo de Clientes.

  const anio = new Date().getFullYear()
  const mes = new Date().getMonth() + 1
  const META_CITAS_MES = calcularMetaCitas(anio, mes)

  // Puntualidad del mes — checadas sin tardanza injustificada
  const tardanzasInjustificadas = checadas.filter(c => c.llego_tarde && !c.tiene_cita).length
  const juntasFaltadas = checadas.filter(c => c.tipo === 'junta').length === 0 && new Date().getDay() > 2
    ? 1 : 0 // simplificado: si ya pasó el martes y no checó junta
  const esPuntual = tardanzasInjustificadas === 0

  const statsAsesor = (n) => {
    const registros = kpis.filter(k => k.asesor === n)
    const cierresAsesor = cierres.filter(c => (c.vendedor || '').toLowerCase() === (VENDEDOR_MAP[n] || n.toLowerCase()))
    const ingresos = cierresAsesor.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0)
    const citas_efectivas = registros.reduce((a, k) => a + (k.citas_efectivas || 0), 0)
    return {
      citas_efectivas,
      operaciones: cierresAsesor.length,
      ingresos,
      cumpleIngresos: ingresos >= META_INGRESOS,
      cumpleCitas: citas_efectivas >= META_CITAS_MES,
    }
  }

  const rankingData = NOMBRES_LISTA
    .map(n => ({ nombre: n, ...statsAsesor(n) }))
    .sort((a, b) => b.operaciones - a.operaciones || b.ingresos - a.ingresos)

  const BONOS = [5000, 3000, 1500]
  // Para el bono ahora también se requiere puntualidad
  const candidatosBono = rankingData
    .filter(a => a.cumpleIngresos && a.cumpleCitas && (a.nombre !== nombre || esPuntual))
    .slice(0, 3)

  const miStats = nombre ? statsAsesor(nombre) : null
  const miBonoIndex = candidatosBono.findIndex(c => c.nombre === nombre)
  const miBonoMonto = miBonoIndex >= 0 ? BONOS[miBonoIndex] : null

  const cumpleParaBono = miStats?.cumpleIngresos && miStats?.cumpleCitas && esPuntual

  const ContadorAutomatico = ({ label, field, color, bg }) => (
    <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 900, color, lineHeight: 1 }}>{form[field]}</div>
    </div>
  )

  if (authLoading || (session && !perfilCargado)) return (
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
              {/* El aviso de "ya registraste hoy" ya no aplica — los
                  contadores siempre reflejan tus citas reales del día,
                  sin necesitar una acción manual de registro. */}

              {/* Estado del bono */}
              {miStats && (
                <div style={{
                  background: cumpleParaBono ? '#f0fdf4' : '#f8f8f8',
                  border: `1px solid ${cumpleParaBono ? '#6ee7b7' : '#e5e7eb'}`,
                  borderRadius: 12, padding: '14px 16px', marginBottom: 16
                }}>
                  <p style={{ margin: '0 0 10px', fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>
                    🎯 Tu bono este mes
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Ingresos */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        {miStats.cumpleIngresos ? '✅' : '🔴'} Meta ingresos {fmt(META_INGRESOS)}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: miStats.cumpleIngresos ? '#065f46' : '#dc2626' }}>
                        {fmt(miStats.ingresos)}
                      </span>
                    </div>
                    {/* Citas */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        {miStats.cumpleCitas ? '✅' : '🔴'} Meta citas ({META_CITAS_MES} este mes)
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: miStats.cumpleCitas ? '#065f46' : '#dc2626' }}>
                        {miStats.citas_efectivas}
                      </span>
                    </div>
                    {/* Puntualidad */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>
                        {esPuntual ? '✅' : '🔴'} Puntualidad
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: esPuntual ? '#065f46' : '#dc2626' }}>
                        {esPuntual ? 'Sin tardanzas' : `${tardanzasInjustificadas} tardanza(s)`}
                      </span>
                    </div>
                  </div>
                  {cumpleParaBono ? (
                    <div style={{ marginTop: 10, background: '#065f46', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#fff' }}>
                        🎉 {miBonoMonto ? `¡Vas ganando ${fmt(miBonoMonto)}!` : '¡Cumples todos los requisitos!'}
                      </p>
                    </div>
                  ) : (
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                      Cumple los 3 requisitos para ser candidato al bono
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                <ContadorAutomatico label="Citas agendadas" field="citas_agendadas" color="#065f46" bg="#f0fdf4" />
                <ContadorAutomatico label="Citas efectivas" field="citas_efectivas" color="#92400e" bg="#fffbeb" />
                <ContadorAutomatico label="Citas calificadas" field="citas_calificadas" color="#b91c3c" bg="#fff0f3" />
              </div>

              <div style={{ background: '#f8f8f8', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                Estos números se calculan solo, desde tus citas de hoy en{' '}
                <a href="/clientes" style={{ color: '#b91c3c', fontWeight: 700, textDecoration: 'none' }}>el módulo de Clientes</a>.
              </div>

              <button onClick={() => window.location.href = '/clientes'}
                style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: '#b91c3c', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer', marginBottom: 10, letterSpacing: 1 }}>
                + Registrar una cita
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
                  const esCandidato = a.cumpleIngresos && a.cumpleCitas
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
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, marginBottom: 6 }}>
                            {a.citas_efectivas} citas · {fmt(a.ingresos)}
                          </div>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: esCandidato ? '#f0fdf4' : '#f3f4f6', border: `1px solid ${esCandidato ? '#6ee7b7' : '#e5e7eb'}`, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: esCandidato ? '#065f46' : '#9ca3af' }}>
                            {esCandidato ? '🟢 Candidato bono' : '🔴 Sin bono'}
                          </div>
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
