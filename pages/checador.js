import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const PERSONAL = {
  'ariannet81@gmail.com':              { nombre: 'Ariannet', rol: 'asesor',  horario: 'guardia' },
  'angelicamomox@gmail.com':           { nombre: 'Angélica', rol: 'asesor',  horario: 'guardia' },
  'rddd298@gmail.com':                 { nombre: 'Rosario',  rol: 'asesor',  horario: 'guardia' },
  'ivanmtzco@gmail.com':               { nombre: 'Iván',     rol: 'asesor',  horario: 'guardia' },
  'nextelmoto2@gmail.com':             { nombre: 'Andrea',   rol: 'asesor',  horario: 'guardia' },
  'islas.amanda111@gmail.com':         { nombre: 'Amanda',   rol: 'asesor',  horario: 'guardia' },
  'guillermo@emporioinmobiliario.com.mx': { nombre: 'Guillermo', rol: 'gerente', horario: 'junta' },
  'juridico@emporioinmobiliario.mx':   { nombre: 'Zaye',     rol: 'staff',   horario: 'lv_9_5' },
  'asistente1@emporioinmobiliario.mx': { nombre: 'Tania',    rol: 'staff',   horario: 'lv_9_5_s_10_2' },
}

const ADMINS = [
  'carlos.nachon@emporioinmobiliario.mx',
  'guillermo@emporioinmobiliario.com.mx',
]

const TODOS_NOMBRES = Object.values(PERSONAL).map(p => p.nombre)

const fmt12 = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })
}

const fmtFecha = (f) => {
  if (!f) return '—'
  const d = new Date(f + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
}

const getFechaMexico = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
const getHoraMexico = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' })
const getDiaSemana = () => new Date().toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'America/Mexico_City' }).toLowerCase()

const esMartes = () => new Date().toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'America/Mexico_City' }) === 'Tue' || getDiaSemana() === 'martes'

export default function Checador() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tab, setTab] = useState('checador')
  const [toast, setToast] = useState(null)

  // Checador state
  const [checadas, setChecadas] = useState([])
  const [checadasHoy, setChecadasHoy] = useState([])
  const [guardias, setGuardias] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [tieneCita, setTieneCita] = useState(false)
  const [historial, setHistorial] = useState([])

  // Llaves state
  const [llaves, setLlaves] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [showModalLlave, setShowModalLlave] = useState(false)
  const [showModalPrestamo, setShowModalPrestamo] = useState(null)
  const [showModalDevolver, setShowModalDevolver] = useState(null)
  const [showModalTraspaso, setShowModalTraspaso] = useState(null)
  const [formLlave, setFormLlave] = useState({ numero: '', propiedad: '', notas: '' })
  const [formPrestamo, setFormPrestamo] = useState({ notas: '' })
  const [formTraspaso, setFormTraspaso] = useState({ para_email: '', notas: '' })
  const [savingLlave, setSavingLlave] = useState(false)
  const [busquedaLlave, setBusquedaLlave] = useState('')
  const [filtroLlave, setFiltroLlave] = useState('todas')

  // Admin state
  const [vistaAdmin, setVistaAdmin] = useState('hoy')
  const [checadasAdmin, setChecadasAdmin] = useState([])
  const [guardiasAdmin, setGuardiasAdmin] = useState([])
  const [showModalGuardia, setShowModalGuardia] = useState(false)
  const [formGuardia, setFormGuardia] = useState({ email: '', fecha: '' })

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const email = session?.user?.email
  const persona = PERSONAL[email] || null
  const esAdmin = ADMINS.includes(email)
  const esCarlos = email === 'carlos.nachon@emporioinmobiliario.mx'
  const soloLlaves = esCarlos

  useEffect(() => {
    if (!session) return
    loadLlaves()
    loadMovimientos()
    if (!soloLlaves) {
      loadChecadasHoy()
      loadHistorial()
    }
    if (esAdmin) {
      loadChecadasAdmin()
      loadGuardiasAdmin()
    }
  }, [session])

  // ── CHECADOR ──
  const loadChecadasHoy = async () => {
    const hoy = getFechaMexico()
    const { data } = await supabase.from('checadas').select('*').eq('email', email).eq('fecha', hoy).order('timestamp', { ascending: true })
    setChecadasHoy(data || [])
  }

  const loadHistorial = async () => {
    const { data } = await supabase.from('checadas').select('*').eq('email', email).order('timestamp', { ascending: false }).limit(30)
    setHistorial(data || [])
  }

  const loadChecadasAdmin = async () => {
    const hoy = getFechaMexico()
    const inicioMes = hoy.substring(0, 7) + '-01'
    const { data } = await supabase.from('checadas').select('*').gte('fecha', inicioMes).order('timestamp', { ascending: false })
    setChecadasAdmin(data || [])
  }

  const loadGuardiasAdmin = async () => {
    const hoy = getFechaMexico()
    const { data } = await supabase.from('guardias').select('*').gte('fecha_guardia', hoy).order('fecha_guardia', { ascending: true })
    setGuardiasAdmin(data || [])
  }

  const tieneGuardiaHoy = () => {
    if (!persona || persona.rol !== 'asesor') return false
    const hoy = getFechaMexico()
    return guardiasAdmin.some(g => g.email === email && g.fecha_guardia === hoy)
  }

  const esJuntaHoy = () => {
    const dia = new Date().getDay() // 0=dom, 2=mar
    return dia === 2
  }

  const puedeChecar = () => {
    if (!persona) return false
    if (persona.rol === 'staff') return true
    if (persona.rol === 'gerente') return esJuntaHoy()
    if (persona.rol === 'asesor') return tieneGuardiaHoy() || esJuntaHoy()
    return false
  }

  const ultimaChecada = checadasHoy[checadasHoy.length - 1]
  const yaEntro = checadasHoy.some(c => c.tipo === 'entrada' || c.tipo === 'junta')
  const yaSalio = checadasHoy.some(c => c.tipo === 'salida')

  const getHoraEsperada = () => {
    if (!persona) return null
    const hoy = getFechaMexico()
    const esSabado = new Date().getDay() === 6
    if (persona.rol === 'staff') {
      if (esSabado && persona.horario === 'lv_9_5_s_10_2') return '10:00'
      return '09:00'
    }
    if (persona.rol === 'gerente') return '10:00' // junta
    if (persona.rol === 'asesor') {
      if (esJuntaHoy()) return '10:00'
      if (tieneGuardiaHoy()) return '09:00'
    }
    return '09:00'
  }

  const getTipoChecada = () => {
    if (persona?.rol === 'gerente') return 'junta'
    if (persona?.rol === 'asesor' && esJuntaHoy() && !tieneGuardiaHoy()) return 'junta'
    if (persona?.rol === 'asesor' && esJuntaHoy() && tieneGuardiaHoy()) return 'entrada'
    return 'entrada'
  }

  const checar = async (tipo) => {
    if (!persona) return
    setGuardando(true)
    const hoy = getFechaMexico()
    let lat = null, lng = null
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }))
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch (e) { /* sin geo */ }

    const { error } = await supabase.from('checadas').insert({
      email,
      nombre: persona.nombre,
      tipo,
      fecha: hoy,
      lat,
      lng,
      tiene_cita: tipo === 'entrada' ? tieneCita : false,
    })
    if (error) { showToast('Error: ' + error.message, false) }
    else { showToast(tipo === 'entrada' ? '✅ Entrada registrada' : tipo === 'salida' ? '👋 Salida registrada' : '✅ Asistencia a junta registrada') }
    setGuardando(false)
    loadChecadasHoy()
    loadHistorial()
    if (esAdmin) loadChecadasAdmin()
  }

  // ── LLAVES ──
  const loadLlaves = async () => {
    const { data } = await supabase.from('llaves').select('*').eq('activa', true).order('numero', { ascending: true })
    setLlaves(data || [])
  }

  const loadMovimientos = async () => {
    const { data } = await supabase.from('llaves_movimientos').select('*').order('timestamp', { ascending: false }).limit(50)
    setMovimientos(data || [])
  }

  const guardarLlave = async () => {
    if (!formLlave.numero || !formLlave.propiedad) return
    setSavingLlave(true)
    const { error } = await supabase.from('llaves').insert({
      numero: parseInt(formLlave.numero),
      propiedad: formLlave.propiedad,
      notas: formLlave.notas,
      en_resguardo: true,
      portador_nombre: 'Tania',
      portador_email: 'asistente1@emporioinmobiliario.mx',
    })
    setSavingLlave(false)
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast('Llave registrada ✅')
    setShowModalLlave(false)
    setFormLlave({ numero: '', propiedad: '', notas: '' })
    loadLlaves()
  }

  const prestarLlave = async (llave) => {
    if (!persona && !esAdmin) return
    setSavingLlave(true)
    const portadorEmail = email
    const portadorNombre = persona?.nombre || 'Admin'
    const { error } = await supabase.from('llaves').update({
      en_resguardo: false,
      portador_email: portadorEmail,
      portador_nombre: portadorNombre,
      fecha_prestamo: new Date().toISOString(),
    }).eq('id', llave.id)
    if (!error) {
      await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id,
        numero: llave.numero,
        propiedad: llave.propiedad,
        tipo: 'prestamo',
        de_email: llave.portador_email,
        de_nombre: llave.portador_nombre,
        para_email: portadorEmail,
        para_nombre: portadorNombre,
        notas: formPrestamo.notas,
      })
      showToast(`🔑 Llave #${llave.numero} tomada`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalPrestamo(null)
    setFormPrestamo({ notas: '' })
    loadLlaves()
    loadMovimientos()
  }

  const devolverLlave = async (llave) => {
    setSavingLlave(true)
    const { error } = await supabase.from('llaves').update({
      en_resguardo: true,
      portador_email: 'asistente1@emporioinmobiliario.mx',
      portador_nombre: 'Tania',
      fecha_prestamo: null,
    }).eq('id', llave.id)
    if (!error) {
      await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id,
        numero: llave.numero,
        propiedad: llave.propiedad,
        tipo: 'devolucion',
        de_email: llave.portador_email,
        de_nombre: llave.portador_nombre,
        para_email: 'asistente1@emporioinmobiliario.mx',
        para_nombre: 'Tania',
      })
      showToast(`✅ Llave #${llave.numero} devuelta a Tania`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalDevolver(null)
    loadLlaves()
    loadMovimientos()
  }

  const traspasarLlave = async (llave) => {
    if (!formTraspaso.para_email) return
    setSavingLlave(true)
    const paraPersona = PERSONAL[formTraspaso.para_email]
    const paraNombre = paraPersona?.nombre || formTraspaso.para_email
    const { error } = await supabase.from('llaves').update({
      portador_email: formTraspaso.para_email,
      portador_nombre: paraNombre,
      fecha_prestamo: new Date().toISOString(),
    }).eq('id', llave.id)
    if (!error) {
      await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id,
        numero: llave.numero,
        propiedad: llave.propiedad,
        tipo: 'traspaso',
        de_email: llave.portador_email,
        de_nombre: llave.portador_nombre,
        para_email: formTraspaso.para_email,
        para_nombre: paraNombre,
        notas: formTraspaso.notas,
      })
      showToast(`🔑 Llave #${llave.numero} traspasada a ${paraNombre}`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalTraspaso(null)
    setFormTraspaso({ para_email: '', notas: '' })
    loadLlaves()
    loadMovimientos()
  }

  const darDeBajaLlave = async (llave) => {
    if (!confirm(`¿Dar de baja la llave #${llave.numero} (${llave.propiedad})?`)) return
    await supabase.from('llaves').update({ activa: false }).eq('id', llave.id)
    showToast(`Llave #${llave.numero} dada de baja`)
    loadLlaves()
  }

  // ── GUARDIAS ADMIN ──
  const guardarGuardia = async () => {
    if (!formGuardia.email || !formGuardia.fecha) return
    const persona = PERSONAL[formGuardia.email]
    if (!persona) return
    const { error } = await supabase.from('guardias').upsert({
      email: formGuardia.email,
      nombre: persona.nombre,
      fecha_guardia: formGuardia.fecha,
    }, { onConflict: 'email,fecha_guardia' })
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`Guardia asignada a ${persona.nombre}`)
    setShowModalGuardia(false)
    setFormGuardia({ email: '', fecha: '' })
    loadGuardiasAdmin()
  }

  // Login
  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  )

  if (!session) return <Login />

  if (!persona && !esAdmin && !esCarlos) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', background: '#fff', padding: 40, borderRadius: 16, border: '1px solid #e5e7eb' }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 48, marginBottom: 16 }} />
        <p style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Sin acceso</p>
        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>{email}</p>
        <button onClick={() => supabase.auth.signOut()} style={{ background: '#b91c3c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 700 }}>Salir</button>
      </div>
    </div>
  )

  const llavesDisponibles = llaves.filter(l => {
    if (busquedaLlave) return l.propiedad.toLowerCase().includes(busquedaLlave.toLowerCase()) || l.numero.toString().includes(busquedaLlave)
    if (filtroLlave === 'resguardo') return l.en_resguardo
    if (filtroLlave === 'prestadas') return !l.en_resguardo
    if (filtroLlave === 'mias') return l.portador_email === email
    return true
  })

  const horaEsperada = getHoraEsperada()
  const horaActual = getHoraMexico()
  const llegaTarde = horaEsperada && horaActual > horaEsperada + ':15' && persona?.rol !== 'gerente'
  const llegoATiempo = yaEntro && checadasHoy[0]?.timestamp && new Date(checadasHoy[0].timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }) <= (horaEsperada || '09:15')

  const TABS = soloLlaves
    ? [{ id: 'llaves', label: '🔑 Llaves' }]
    : persona?.rol === 'gerente'
    ? [{ id: 'checador', label: '⏰ Checador' }, { id: 'llaves', label: '🔑 Llaves' }]
    : [{ id: 'checador', label: '⏰ Checador' }, { id: 'llaves', label: '🔑 Llaves' }]

  if (esAdmin && !soloLlaves) TABS.push({ id: 'admin', label: '📊 Admin' })
  if (esCarlos) {
    TABS.push({ id: 'llaves', label: '🔑 Llaves' }, { id: 'admin', label: '📊 Admin' })
  }

  // Tabs únicos
  const tabsUnicos = TABS.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)

  return (
    <>
      <Head>
        <title>Checador · Emporio</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#f8f8f8', fontFamily: 'system-ui, sans-serif' }}>
        {toast && (
          <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#065f46' : '#b91c3c', color: '#fff', padding: '12px 24px', borderRadius: 100, fontWeight: 700, fontSize: 14, zIndex: 999, whiteSpace: 'nowrap' }}>
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ background: '#1a1a2e', padding: '14px 20px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 28, objectFit: 'contain' }} />
              <div>
                <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Emporio Inmobiliario</p>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff' }}>{persona?.nombre || 'Admin'}</p>
              </div>
            </div>
            <button onClick={() => supabase.auth.signOut()} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '6px 12px', color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer' }}>Salir</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 20px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', gap: 0 }}>
            {tabsUnicos.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ flex: 1, padding: '14px 8px', border: 'none', borderBottom: `2px solid ${tab === t.id ? '#b91c3c' : 'transparent'}`, background: 'transparent', color: tab === t.id ? '#b91c3c' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' }}>

          {/* ── TAB CHECADOR ── */}
          {tab === 'checador' && !soloLlaves && (
            <div>
              {/* Info del día */}
              <div style={{ background: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, border: '1px solid #e5e7eb' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                  {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })}
                </p>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {horaEsperada && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>Entrada esperada</p>
                      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>{horaEsperada}</p>
                    </div>
                  )}
                  {yaEntro && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>Tu entrada</p>
                      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: llegoATiempo ? '#065f46' : '#dc2626' }}>
                        {fmt12(checadasHoy[0]?.timestamp)}
                        {llegoATiempo ? ' ✅' : ' ⚠️'}
                      </p>
                    </div>
                  )}
                  {yaSalio && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>Tu salida</p>
                      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#374151' }}>
                        {fmt12(checadasHoy.filter(c => c.tipo === 'salida').pop()?.timestamp)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Aviso si no tiene guardia hoy (asesores) */}
              {persona?.rol === 'asesor' && !tieneGuardiaHoy() && !esJuntaHoy() && (
                <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 16, marginBottom: 14, textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#92400e' }}>No tienes guardia hoy</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#92400e' }}>Tu guardia será asignada por Guillermo o Carlos</p>
                </div>
              )}

              {/* Junta martes */}
              {esJuntaHoy() && (
                <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e40af' }}>📅 Junta de equipo hoy</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#1e40af' }}>10:00 AM · Tolerancia 0 minutos</p>
                </div>
              )}

              {/* Tiene cita (solo asesores en guardia) */}
              {persona?.rol === 'asesor' && tieneGuardiaHoy() && !yaEntro && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={tieneCita} onChange={e => setTieneCita(e.target.checked)} style={{ width: 18, height: 18 }} />
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#374151' }}>Tengo cita este día</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>Justifica llegada después de las 9:15</p>
                  </div>
                </label>
              )}

              {/* Botones de checada */}
              {puedeChecar() && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {/* Junta */}
                  {esJuntaHoy() && !checadasHoy.some(c => c.tipo === 'junta') && (
                    <button onClick={() => checar('junta')} disabled={guardando}
                      style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: guardando ? '#e5e7eb' : '#1e40af', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
                      {guardando ? 'Registrando...' : '📅 Registrar asistencia a junta'}
                    </button>
                  )}
                  {/* Entrada */}
                  {(tieneGuardiaHoy() || persona?.rol === 'staff') && !yaEntro && (
                    <button onClick={() => checar('entrada')} disabled={guardando}
                      style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: guardando ? '#e5e7eb' : '#065f46', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
                      {guardando ? 'Registrando...' : '🟢 Registrar Entrada'}
                    </button>
                  )}
                  {/* Salida */}
                  {(tieneGuardiaHoy() || persona?.rol === 'staff') && yaEntro && !yaSalio && (
                    <button onClick={() => checar('salida')} disabled={guardando}
                      style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: guardando ? '#e5e7eb' : '#b91c3c', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
                      {guardando ? 'Registrando...' : '🔴 Registrar Salida'}
                    </button>
                  )}
                  {yaEntro && yaSalio && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#065f46' }}>✅ Checadas completas del día</p>
                    </div>
                  )}
                </div>
              )}

              {/* Historial */}
              {historial.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Últimas checadas</p>
                  {historial.slice(0, 10).map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: c.tipo === 'entrada' ? '#065f46' : c.tipo === 'salida' ? '#b91c3c' : '#1e40af', textTransform: 'capitalize', marginRight: 8 }}>
                          {c.tipo === 'entrada' ? '🟢' : c.tipo === 'salida' ? '🔴' : '📅'} {c.tipo}
                        </span>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtFecha(c.fecha)}</span>
                        {c.tiene_cita && <span style={{ fontSize: 10, color: '#7c3aed', marginLeft: 6, fontWeight: 600 }}>· con cita</span>}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{fmt12(c.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB LLAVES ── */}
          {tab === 'llaves' && (
            <div>
              {/* Resumen */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                {[
                  { label: 'Total', value: llaves.length, color: '#1a1a2e' },
                  { label: 'Resguardo', value: llaves.filter(l => l.en_resguardo).length, color: '#065f46' },
                  { label: 'Prestadas', value: llaves.filter(l => !l.en_resguardo).length, color: '#b91c3c' },
                ].map((s, i) => (
                  <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '12px 10px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                    <p style={{ margin: '0 0 2px', fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</p>
                    <p style={{ margin: 0, fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Filtros + busqueda */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input placeholder="Buscar # o propiedad..." value={busquedaLlave} onChange={e => setBusquedaLlave(e.target.value)}
                  style={{ flex: 1, minWidth: 140, padding: '9px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14 }} />
                <select value={filtroLlave} onChange={e => setFiltroLlave(e.target.value)}
                  style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff' }}>
                  <option value="todas">Todas</option>
                  <option value="resguardo">En resguardo</option>
                  <option value="prestadas">Prestadas</option>
                  <option value="mias">Las mías</option>
                </select>
              </div>

              {/* Botón nueva llave (solo admins y Tania) */}
              {(esAdmin || esCarlos || email === 'asistente1@emporioinmobiliario.mx') && (
                <button onClick={() => setShowModalLlave(true)}
                  style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px dashed #b91c3c', background: '#fff0f3', color: '#b91c3c', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>
                  + Registrar nueva llave
                </button>
              )}

              {/* Lista llaves */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {llavesDisponibles.map(llave => {
                  const esMia = llave.portador_email === email
                  const enResguardo = llave.en_resguardo
                  return (
                    <div key={llave.id} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `1px solid ${esMia ? '#fca5a5' : enResguardo ? '#e5e7eb' : '#fcd34d'}`, borderLeft: `4px solid ${esMia ? '#b91c3c' : enResguardo ? '#065f46' : '#f59e0b'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ background: '#1a1a2e', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 14, fontWeight: 900 }}>#{llave.numero}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{llave.propiedad}</span>
                          </div>
                          <p style={{ margin: '6px 0 0', fontSize: 12, color: enResguardo ? '#065f46' : esMia ? '#b91c3c' : '#92400e', fontWeight: 600 }}>
                            {enResguardo ? '✅ En resguardo (Tania)' : esMia ? '🔑 La tienes tú' : `📍 Con ${llave.portador_nombre}`}
                          </p>
                          {llave.fecha_prestamo && !enResguardo && (
                            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>
                              Desde {new Date(llave.fecha_prestamo).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                          {llave.notas && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>{llave.notas}</p>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {enResguardo && (
                          <button onClick={() => setShowModalPrestamo(llave)}
                            style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            🔑 Tomar llave
                          </button>
                        )}
                        {!enResguardo && esMia && (
                          <>
                            <button onClick={() => setShowModalDevolver(llave)}
                              style={{ background: '#f0fdf4', color: '#065f46', border: '1px solid #86efac', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                              ✅ Devolver a Tania
                            </button>
                            <button onClick={() => setShowModalTraspaso(llave)}
                              style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                              ↔️ Traspasar
                            </button>
                          </>
                        )}
                        {(esAdmin || esCarlos) && !enResguardo && !esMia && (
                          <button onClick={() => setShowModalDevolver(llave)}
                            style={{ background: '#f0fdf4', color: '#065f46', border: '1px solid #86efac', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            ✅ Marcar devuelta
                          </button>
                        )}
                        {(esAdmin || esCarlos || email === 'asistente1@emporioinmobiliario.mx') && (
                          <button onClick={() => darDeBajaLlave(llave)}
                            style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            Dar de baja
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {llavesDisponibles.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                    <p style={{ fontSize: 32, margin: '0 0 8px' }}>🔑</p>
                    <p>No hay llaves{busquedaLlave ? ' con ese criterio' : ' registradas'}</p>
                  </div>
                )}
              </div>

              {/* Últimos movimientos */}
              {movimientos.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #e5e7eb', marginTop: 16 }}>
                  <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Últimos movimientos</p>
                  {movimientos.slice(0, 8).map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: m.tipo === 'devolucion' ? '#065f46' : m.tipo === 'prestamo' ? '#b91c3c' : '#92400e' }}>
                          {m.tipo === 'prestamo' ? '🔑' : m.tipo === 'devolucion' ? '✅' : '↔️'} #{m.numero} {m.propiedad}
                        </span>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>
                          {m.de_nombre} → {m.para_nombre}
                        </p>
                      </div>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmt12(m.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB ADMIN ── */}
          {tab === 'admin' && (esAdmin || esCarlos) && (
            <div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {[['hoy', '📍 Hoy'], ['semana', '📅 Semana'], ['guardias', '🗓️ Guardias']].map(([id, label]) => (
                  <button key={id} onClick={() => setVistaAdmin(id)}
                    style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${vistaAdmin === id ? '#b91c3c' : '#e5e7eb'}`, background: vistaAdmin === id ? '#fff0f3' : '#fff', color: vistaAdmin === id ? '#b91c3c' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* HOY */}
              {vistaAdmin === 'hoy' && (
                <div>
                  <p style={{ margin: '0 0 12px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                    {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })}
                  </p>
                  {TODOS_NOMBRES.map(nombre => {
                    const checadasPersona = checadasAdmin.filter(c => c.nombre === nombre && c.fecha === getFechaMexico())
                    const entrada = checadasPersona.find(c => c.tipo === 'entrada')
                    const salida = checadasPersona.find(c => c.tipo === 'salida')
                    const junta = checadasPersona.find(c => c.tipo === 'junta')
                    const checaron = checadasPersona.length > 0
                    return (
                      <div key={nombre} style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 8, border: `1px solid ${checaron ? '#e5e7eb' : '#f3f4f6'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: checaron ? '#065f46' : '#e5e7eb' }} />
                          <span style={{ fontSize: 14, fontWeight: 700, color: checaron ? '#374151' : '#9ca3af' }}>{nombre}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          {junta && <span style={{ fontSize: 12, color: '#1e40af', fontWeight: 700 }}>📅 {fmt12(junta.timestamp)}</span>}
                          {entrada && <span style={{ fontSize: 12, color: '#065f46', fontWeight: 700 }}>🟢 {fmt12(entrada.timestamp)}</span>}
                          {salida && <span style={{ fontSize: 12, color: '#b91c3c', fontWeight: 700 }}>🔴 {fmt12(salida.timestamp)}</span>}
                          {!checaron && <span style={{ fontSize: 12, color: '#d1d5db' }}>Sin checada</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* SEMANA */}
              {vistaAdmin === 'semana' && (
                <div>
                  <p style={{ margin: '0 0 12px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Últimos 7 días</p>
                  <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f9fafb' }}>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>Persona</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>Fecha</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>Tipo</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>Hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checadasAdmin.slice(0, 30).map((c, i) => (
                          <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600 }}>{c.nombre}</td>
                            <td style={{ padding: '9px 12px', fontSize: 12, color: '#9ca3af' }}>{fmtFecha(c.fecha)}</td>
                            <td style={{ padding: '9px 12px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: c.tipo === 'entrada' ? '#065f46' : c.tipo === 'salida' ? '#b91c3c' : '#1e40af', textTransform: 'capitalize' }}>
                                {c.tipo === 'entrada' ? '🟢' : c.tipo === 'salida' ? '🔴' : '📅'} {c.tipo}
                                {c.tiene_cita && ' (con cita)'}
                              </span>
                            </td>
                            <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700 }}>{fmt12(c.timestamp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* GUARDIAS */}
              {vistaAdmin === 'guardias' && (
                <div>
                  <button onClick={() => setShowModalGuardia(true)}
                    style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px dashed #b91c3c', background: '#fff0f3', color: '#b91c3c', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>
                    + Asignar guardia
                  </button>
                  {guardiasAdmin.length === 0 && (
                    <p style={{ textAlign: 'center', color: '#9ca3af', padding: 32 }}>No hay guardias asignadas próximamente</p>
                  )}
                  {guardiasAdmin.map((g, i) => (
                    <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 8, border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#374151' }}>{g.nombre}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>{fmtFecha(g.fecha_guardia)} · 9:00 AM</p>
                      </div>
                      <button onClick={async () => {
                        await supabase.from('guardias').delete().eq('id', g.id)
                        showToast('Guardia eliminada')
                        loadGuardiasAdmin()
                      }} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── MODALES ── */}

        {/* Nueva llave */}
        {showModalLlave && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Nueva llave</h3>
                <button onClick={() => setShowModalLlave(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Número de llave</label>
                  <input type="number" value={formLlave.numero} onChange={e => setFormLlave(f => ({ ...f, numero: e.target.value }))}
                    placeholder="Ej: 42" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Propiedad</label>
                  <input value={formLlave.propiedad} onChange={e => setFormLlave(f => ({ ...f, propiedad: e.target.value }))}
                    placeholder="Nombre de la propiedad" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas (opcional)</label>
                  <input value={formLlave.notas} onChange={e => setFormLlave(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Ej: Llave azul, copia" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalLlave(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={guardarLlave} disabled={savingLlave || !formLlave.numero || !formLlave.propiedad}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: savingLlave ? 0.6 : 1 }}>
                  {savingLlave ? 'Guardando...' : 'Registrar llave'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tomar llave */}
        {showModalPrestamo && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>🔑 Tomar llave #{showModalPrestamo.numero}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>{showModalPrestamo.propiedad}</p>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas (opcional)</label>
                <input value={formPrestamo.notas} onChange={e => setFormPrestamo(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Ej: Para mostrar hoy en la tarde" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalPrestamo(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => prestarLlave(showModalPrestamo)} disabled={savingLlave}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                  {savingLlave ? 'Registrando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Devolver llave */}
        {showModalDevolver && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400, textAlign: 'center' }}>
              <p style={{ fontSize: 48, margin: '0 0 8px' }}>✅</p>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>Devolver llave #{showModalDevolver.numero}</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#9ca3af' }}>{showModalDevolver.propiedad} → Tania (resguardo)</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowModalDevolver(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => devolverLlave(showModalDevolver)} disabled={savingLlave}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#065f46', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                  {savingLlave ? 'Registrando...' : 'Confirmar devolución'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Traspasar llave */}
        {showModalTraspaso && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 800 }}>↔️ Traspasar llave #{showModalTraspaso.numero}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>{showModalTraspaso.propiedad}</p>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>¿A quién?</label>
                  <select value={formTraspaso.para_email} onChange={e => setFormTraspaso(f => ({ ...f, para_email: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                    <option value="">Selecciona...</option>
                    {Object.entries(PERSONAL)
                      .filter(([em]) => em !== email)
                      .map(([em, p]) => <option key={em} value={em}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas (opcional)</label>
                  <input value={formTraspaso.notas} onChange={e => setFormTraspaso(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Ej: La llevo yo en la tarde" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalTraspaso(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => traspasarLlave(showModalTraspaso)} disabled={savingLlave || !formTraspaso.para_email}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#92400e', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: !formTraspaso.para_email ? 0.5 : 1 }}>
                  {savingLlave ? 'Registrando...' : 'Traspasar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Asignar guardia */}
        {showModalGuardia && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>🗓️ Asignar guardia</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Asesor</label>
                  <select value={formGuardia.email} onChange={e => setFormGuardia(f => ({ ...f, email: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                    <option value="">Selecciona...</option>
                    {Object.entries(PERSONAL)
                      .filter(([, p]) => p.rol === 'asesor')
                      .map(([em, p]) => <option key={em} value={em}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Fecha</label>
                  <input type="date" value={formGuardia.fecha} onChange={e => setFormGuardia(f => ({ ...f, fecha: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalGuardia(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={guardarGuardia} disabled={!formGuardia.email || !formGuardia.fecha}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#b91c3c', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: !formGuardia.email || !formGuardia.fecha ? 0.5 : 1 }}>
                  Asignar
                </button>
              </div>
            </div>
          </div>
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
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: 'https://app.emporioinmobiliario.com.mx/checador' } })
    setLoading(false); setSent(true)
  }
  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 56, objectFit: 'contain', marginBottom: 24 }} />
      <div style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: 32, border: '1px solid #e5e7eb' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#1a1a2e', textAlign: 'center' }}>Checador + Llaves</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>Emporio Inmobiliario</p>
        {!sent ? (
          <>
            <input type="email" placeholder="tu@correo.com" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }} />
            <button onClick={send} disabled={loading || !email}
              style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: loading || !email ? 0.5 : 1 }}>
              {loading ? 'Enviando...' : 'Enviar enlace →'}
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📧</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 6 }}>Revisa tu correo</p>
            <p style={{ color: '#9ca3af', fontSize: 13 }}>{email}</p>
          </div>
        )}
      </div>
    </div>
  )
}
