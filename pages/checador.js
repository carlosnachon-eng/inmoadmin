import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Estos roles tienen acceso de Admin dentro de Checador (ven y editan todo,
// pueden agregar guardias). Antes era una lista de correos sueltos; ahora
// son roles de la tabla `roles`, así que agregar a alguien nuevo es cambiar
// su rol en profiles, no tocar este código.
const ROLES_CON_ACCESO_ADMIN_CHECADOR = ['admin', 'gerente_ventas']
const ROLES_QUE_PUEDEN_PRESTAR_LLAVES = ['admin', 'gerente_ventas', 'coord_operaciones']
const ROLES_EQUIPO_INTERNO = ['admin', 'gerente_ventas', 'coord_operaciones', 'juridico', 'asesor', 'chofer']
const isPartnerEmail = (email, partnerEmails) => partnerEmails.has(String(email || '').toLowerCase())

// El horario/turno de cada persona sigue siendo un dato manual que tú
// asignas (no todos los asesores tienen el mismo turno) — esto se mantiene
// como configuración editable aquí, pero separado del ROL (que ya no se
// hardcodea). Si agregas a alguien nuevo al equipo, agrégalo aquí también
// con su horario, y asegúrate de que su cuenta en profiles tenga role_id
// correcto (admin/gerente_ventas/coord_operaciones/juridico/asesor/chofer).
const HORARIOS_POR_EMAIL = {
  'carlos.nachon@emporioinmobiliario.mx': null,
  'ariannet81@gmail.com': 'guardia',
  'angelicamomox@gmail.com': 'guardia',
  'rddd298@gmail.com': 'guardia',
  'ivanmtzco@gmail.com': 'guardia',
  'nextelmoto2@gmail.com': 'guardia',
  'islas.amanda111@gmail.com': 'guardia',
  'guillermo@emporioinmobiliario.com.mx': 'junta',
  'juridico@emporioinmobiliario.mx': 'lv_9_5',
  'asistente1@emporioinmobiliario.mx': 'lv_9_5_s_10_2',
}

const OFICINA_LAT = 19.0135225
const OFICINA_LNG = -98.268092
const RADIO_METROS = 100

const distanciaMetros = (lat1, lng1, lat2, lng2) => {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

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

const diasFuera = (fecha_prestamo) => {
  if (!fecha_prestamo) return 0
  const ahora = new Date()
  const prestamo = new Date(fecha_prestamo)
  return Math.floor((ahora - prestamo) / (1000 * 60 * 60 * 24))
}

const MOTIVOS_BAJA = ['Se rentó la propiedad', 'Se vendió la propiedad', 'Se devolvió al propietario', 'Se perdió', 'Se duplicó el registro', 'Otro']
const MOTIVOS_SIN_RECEPTOR = ['Se perdió', 'Se duplicó el registro']
const FORM_VEHICULO_INICIAL = {
  vehiculo_id: '',
  vehiculo_nombre_manual: '',
  kilometraje: '',
  gasolina: '',
  condicion: 'bien',
  observaciones: '',
  foto_tablero: null,
}

function ReceptorForm({ form, setForm, listaPersonas }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[{ v: 'personal', l: '👤 Equipo' }, { v: 'externo', l: '🌐 Externo' }, { v: 'candado', l: '🔒 Candado' }].map(op => (
          <button key={op.v} onClick={() => setForm(f => ({ ...f, tipo_receptor: op.v, para_email: '', nombre_externo: '', codigo_candado: '' }))}
            style={{ flex: 1, padding: '8px', borderRadius: 8, border: `1px solid ${form.tipo_receptor === op.v ? '#1a1a2e' : '#e5e7eb'}`, background: form.tipo_receptor === op.v ? '#1a1a2e' : '#fff', color: form.tipo_receptor === op.v ? '#fff' : '#9ca3af', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            {op.l}
          </button>
        ))}
      </div>
      {form.tipo_receptor === 'personal' ? (
        <select value={form.para_email} onChange={e => setForm(f => ({ ...f, para_email: e.target.value }))}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
          <option value="">Selecciona persona...</option>
          {(listaPersonas || []).map(p => (
            <option key={p.email} value={p.email}>{p.nombre}</option>
          ))}
        </select>
      ) : form.tipo_receptor === 'externo' ? (
        <input value={form.nombre_externo} onChange={e => setForm(f => ({ ...f, nombre_externo: e.target.value }))}
          placeholder="Ej: Propietario Juan López, Mantenimiento..."
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={form.nombre_externo} onChange={e => setForm(f => ({ ...f, nombre_externo: e.target.value }))}
            placeholder="Nombre o dirección de la propiedad..."
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #1a1a2e', fontSize: 14, boxSizing: 'border-box' }} />
          <input value={form.codigo_candado || ''} onChange={e => setForm(f => ({ ...f, codigo_candado: e.target.value }))}
            placeholder="Código del candado (opcional)"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
        </div>
      )}
    </div>
  )
}

export default function Checador() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tab, setTab] = useState('llaves')
  const [toast, setToast] = useState(null)

  // Checador
  const [checadasHoy, setChecadasHoy] = useState([])
  const [guardias, setGuardias] = useState([])
  const [historial, setHistorial] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [tieneCita, setTieneCita] = useState(false)
  const [motivoTarde, setMotivoTarde] = useState('')
  const [vehiculos, setVehiculos] = useState([])
  const [movimientosVehiculo, setMovimientosVehiculo] = useState([])
  const [formVehiculo, setFormVehiculo] = useState(FORM_VEHICULO_INICIAL)
  const [guardandoVehiculo, setGuardandoVehiculo] = useState(false)
  const [vehiculosDisponibles, setVehiculosDisponibles] = useState(true)

  // Llaves
  const [llaves, setLlaves] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [showModalLlave, setShowModalLlave] = useState(false)
  const [showModalPrestamo, setShowModalPrestamo] = useState(null)
  const [showModalTomar, setShowModalTomar] = useState(null)
  const [showModalDevolver, setShowModalDevolver] = useState(null)
  const [showModalTraspaso, setShowModalTraspaso] = useState(null)
  const [showModalBaja, setShowModalBaja] = useState(null)
  const [showHistorialBajas, setShowHistorialBajas] = useState(false)
  const [llavesInactivas, setLlavesInactivas] = useState([])
  const [formLlave, setFormLlave] = useState({ numero: '', propiedad: '', notas: '' })
  const [formPrestamo, setFormPrestamo] = useState({ tipo_receptor: 'personal', para_email: '', nombre_externo: '', codigo_candado: '', notas: '' })
  const [formTomar, setFormTomar] = useState({ notas: '' })
  const [formTraspaso, setFormTraspaso] = useState({ tipo_receptor: 'personal', para_email: '', nombre_externo: '', codigo_candado: '', notas: '' })
  const [formBaja, setFormBaja] = useState({ motivo: MOTIVOS_BAJA[0], receptor: '', notas: '' })
  const [savingLlave, setSavingLlave] = useState(false)
  const [uploadingFoto, setUploadingFoto] = useState(null)
  const [busquedaLlave, setBusquedaLlave] = useState('')
  const [filtroLlave, setFiltroLlave] = useState('todas')
  const [filtroMovTipo, setFiltroMovTipo] = useState('todos')
  const [filtroMovPersona, setFiltroMovPersona] = useState('todos')
  const [filtroMovBusqueda, setFiltroMovBusqueda] = useState('')
  const [movsPagina, setMovsPagina] = useState(1)
  const MOVS_POR_PAGINA = 15

  // Admin
  const [vistaAdmin, setVistaAdmin] = useState('hoy')
  const [checadasAdmin, setChecadasAdmin] = useState([])
  const [guardiasAdmin, setGuardiasAdmin] = useState([])
  const [movimientosVehiculoAdmin, setMovimientosVehiculoAdmin] = useState([])
  const [showModalGuardia, setShowModalGuardia] = useState(false)
  const [formGuardia, setFormGuardia] = useState({ email: '', fecha: '' })

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const email = session?.user?.email

  // Cargamos el perfil real (con su role_id de la tabla roles) en vez de
  // sacarlo de una lista hardcodeada. Mientras carga, persona es null.
  const [perfilDb, setPerfilDb] = useState(null)
  const [esPartner, setEsPartner] = useState(false)
  const [perfilCargado, setPerfilCargado] = useState(false)
  useEffect(() => {
    if (!session) { setPerfilCargado(true); return }
    Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('partner_users').select('id').eq('auth_user_id', session.user.id).maybeSingle(),
    ]).then(([profileRes, partnerRes]) => {
      setPerfilDb(profileRes.data)
      setEsPartner(!!partnerRes.data)
      setPerfilCargado(true)
    })
  }, [session])

  // Traducimos el role_id nuevo al "rol de comportamiento" viejo que usa
  // el resto de este archivo (staff/gerente/asesor), para no tener que
  // tocar las ~10 referencias dispersas de persona.rol en todo el código.
  const ROL_ID_A_COMPORTAMIENTO = {
    admin: 'admin',
    gerente_ventas: 'gerente',
    coord_operaciones: 'staff',
    juridico: 'staff',
    asesor: 'asesor',
    chofer: 'chofer',
  }

  const persona = perfilDb && perfilDb.active !== false && !esPartner && ROLES_EQUIPO_INTERNO.includes(perfilDb.role_id) ? {
    nombre: (perfilDb.full_name || perfilDb.email || '').split('@')[0] || perfilDb.email,
    rol: ROL_ID_A_COMPORTAMIENTO[perfilDb.role_id],
  } : null

  const esAdmin = ROLES_CON_ACCESO_ADMIN_CHECADOR.includes(perfilDb?.role_id)
  const esCarlos = perfilDb?.role_id === 'admin'
  const soloLlaves = esCarlos // Carlos (Admin) no necesita "checar" su propia asistencia individualmente:
                                // ya tiene la pestaña 📊 Admin con la vista completa del equipo.
  const puedePrestar = ROLES_QUE_PUEDEN_PRESTAR_LLAVES.includes(perfilDb?.role_id)

  // Mapa de nombres reales conocidos, como respaldo mientras full_name
  // en profiles siga vacío (hoy no se está llenando esa columna). Si
  // full_name sí tiene algo, eso tiene prioridad; si no, usamos esto;
  // y si tampoco está aquí, como último recurso usamos lo de antes del @.
  const NOMBRES_CONOCIDOS = {
    'carlos.nachon@emporioinmobiliario.mx': 'Carlos',
    'guillermo@emporioinmobiliario.com.mx': 'Guillermo',
    'juridico@emporioinmobiliario.mx': 'Zaye',
    'asistente1@emporioinmobiliario.mx': 'Tania',
    'ariannet81@gmail.com': 'Ariannet',
    'angelicamomox@gmail.com': 'Angélica',
    'rddd298@gmail.com': 'Rosario',
    'ivanmtzco@gmail.com': 'Iván',
    'nextelmoto2@gmail.com': 'Andrea',
    'islas.amanda111@gmail.com': 'Amanda',
    'ismaelorortiz@gmail.com': 'Ismael Ortiz',
  }

  // Lista de personas del equipo interno (para el selector de "a quién le presto la llave").
  // Antes salía de Object.keys(PERSONAL); ahora se carga de profiles, excluyendo
  // a los roles externos (propietario/inquilino/condómino) que no usan este módulo.
  const [listaPersonas, setListaPersonas] = useState([])
  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('email, full_name, role_id').eq('active', true),
      supabase.from('partner_users').select('email'),
    ]).then(([profilesRes, partnersRes]) => {
        const partnerEmails = new Set((partnersRes.data || []).map(p => String(p.email || '').toLowerCase()))
        const internos = (profilesRes.data || []).filter(p => ROLES_EQUIPO_INTERNO.includes(p.role_id) && !isPartnerEmail(p.email, partnerEmails))
        setListaPersonas(internos.map(p => ({
          email: p.email,
          nombre: p.full_name || NOMBRES_CONOCIDOS[p.email] || p.email.split('@')[0],
          rol: ROL_ID_A_COMPORTAMIENTO[p.role_id],
        })))
      })
  }, [])

  useEffect(() => {
    if (!session) return
    loadLlaves()
    loadMovimientos()
    if (!soloLlaves) {
      loadChecadasHoy()
      loadHistorial()
      loadGuardias()
    }
    if (perfilDb?.role_id === 'chofer') {
      loadVehiculos()
      loadMovimientosVehiculo()
    }
    if (esAdmin || esCarlos) {
      loadChecadasAdmin()
      loadGuardiasAdmin()
      loadMovimientosVehiculoAdmin()
    }
  }, [session, perfilDb?.role_id])

  // Cambiar tab default
  useEffect(() => {
    if (soloLlaves) setTab('llaves')
    else if (persona) setTab('checador')
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

  const loadGuardias = async () => {
    const hoy = getFechaMexico()
    const { data } = await supabase.from('guardias').select('*').eq('email', email).gte('fecha_guardia', hoy)
    setGuardias(data || [])
  }

  const loadVehiculos = async () => {
    const { data, error } = await supabase
      .from('vehiculos')
      .select('*')
      .eq('activo', true)
      .order('nombre', { ascending: true })
    if (error) {
      setVehiculosDisponibles(false)
      return
    }
    setVehiculosDisponibles(true)
    setVehiculos(data || [])
  }

  const loadMovimientosVehiculo = async () => {
    if (!email) return
    const { data, error } = await supabase
      .from('checador_vehiculos_movimientos')
      .select('*')
      .eq('chofer_email', email)
      .order('created_at', { ascending: false })
      .limit(40)
    if (error) {
      setVehiculosDisponibles(false)
      return
    }
    setVehiculosDisponibles(true)
    setMovimientosVehiculo(data || [])
  }

  const loadChecadasAdmin = async () => {
    const hoy = getFechaMexico()
    const inicioMes = hoy.substring(0, 7) + '-01'
    const [{ data }, { data: partners }] = await Promise.all([
      supabase.from('checadas').select('*').gte('fecha', inicioMes).order('timestamp', { ascending: false }),
      supabase.from('partner_users').select('email'),
    ])
    const partnerEmails = new Set((partners || []).map(p => String(p.email || '').toLowerCase()))
    setChecadasAdmin((data || []).filter(c => !isPartnerEmail(c.email, partnerEmails)))
  }

  const loadGuardiasAdmin = async () => {
    const hoy = getFechaMexico()
    const [{ data }, { data: partners }] = await Promise.all([
      supabase.from('guardias').select('*').gte('fecha_guardia', hoy).order('fecha_guardia', { ascending: true }),
      supabase.from('partner_users').select('email'),
    ])
    const partnerEmails = new Set((partners || []).map(p => String(p.email || '').toLowerCase()))
    setGuardiasAdmin((data || []).filter(g => !isPartnerEmail(g.email, partnerEmails)))
  }

  const loadMovimientosVehiculoAdmin = async () => {
    const { data, error } = await supabase
      .from('checador_vehiculos_movimientos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      setVehiculosDisponibles(false)
      setMovimientosVehiculoAdmin([])
      return
    }
    setVehiculosDisponibles(true)
    setMovimientosVehiculoAdmin(data || [])
  }

  const tieneGuardiaHoy = () => {
    const hoy = getFechaMexico()
    return guardias.some(g => g.fecha_guardia === hoy)
  }

  const esJuntaHoy = () => new Date().getDay() === 2 // martes

  const puedeChecar = () => {
    if (!persona) return false
    if (persona.rol === 'staff') return true
    if (persona.rol === 'chofer') return true
    if (persona.rol === 'gerente') return esJuntaHoy()
    if (persona.rol === 'asesor') return tieneGuardiaHoy() || esJuntaHoy()
    return false
  }

  const yaEntro = checadasHoy.some(c => c.tipo === 'entrada')
  const yaSalio = checadasHoy.some(c => c.tipo === 'salida')
  const yaChecoJunta = checadasHoy.some(c => c.tipo === 'junta')

  const getHoraEsperada = () => {
    if (!persona) return null
    const esSabado = new Date().getDay() === 6
    if (persona.rol === 'staff') return esSabado ? '10:00' : '09:00'
    if (persona.rol === 'chofer') return esSabado ? '10:00' : '09:00'
    if (persona.rol === 'gerente') return '10:00'
    if (persona.rol === 'asesor') return esJuntaHoy() && !tieneGuardiaHoy() ? '10:00' : '09:00'
    return '09:00'
  }

  const obtenerGPS = async () => {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, enableHighAccuracy: true }))
    return { lat: pos.coords.latitude, lng: pos.coords.longitude }
  }

  const vehiculoActual = movimientosVehiculo[0]?.tipo === 'regreso_vehiculo' ? null : (movimientosVehiculo[0] || null)

  const getNombreVehiculoForm = () => {
    if (formVehiculo.vehiculo_id === 'otro') return formVehiculo.vehiculo_nombre_manual.trim()
    return vehiculos.find(v => v.id === formVehiculo.vehiculo_id)?.nombre || ''
  }

  const necesitaSeleccionarVehiculo = !vehiculoActual || formVehiculo.vehiculo_id || formVehiculo.vehiculo_nombre_manual

  const validarFormVehiculo = ({ requiereVehiculo = true } = {}) => {
    const km = parseInt(formVehiculo.kilometraje, 10)
    const nombreVehiculo = getNombreVehiculoForm()
    if (requiereVehiculo && !nombreVehiculo) {
      showToast('Selecciona o escribe el vehículo', false)
      return null
    }
    if (!Number.isFinite(km) || km <= 0) {
      showToast('Captura el kilometraje', false)
      return null
    }
    if (!formVehiculo.gasolina) {
      showToast('Selecciona el nivel de gasolina', false)
      return null
    }
    if (!formVehiculo.foto_tablero) {
      showToast('Toma foto del tablero/marcador', false)
      return null
    }
    return { km, nombreVehiculo }
  }

  const subirFotoVehiculo = async (file, tipo) => {
    if (!file) return null
    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `${email || 'chofer'}_${tipo}_${Date.now()}.${ext}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
    const { error: uploadError } = await supabase.storage.from('vehiculos-fotos').upload(fileName, file, { upsert: true })
    if (uploadError) throw uploadError
    const { data: { publicUrl } } = supabase.storage.from('vehiculos-fotos').getPublicUrl(fileName)
    return publicUrl
  }

  const registrarMovimientoVehiculo = async (tipo, { lat, lng, checadaId = null, requiereVehiculo = true } = {}) => {
    const validado = validarFormVehiculo({ requiereVehiculo })
    if (!validado) return { ok: false }

    let fotoUrl = null
    try {
      fotoUrl = await subirFotoVehiculo(formVehiculo.foto_tablero, tipo)
    } catch (e) {
      showToast('Error subiendo foto: ' + e.message, false)
      return { ok: false }
    }

    const esOtro = formVehiculo.vehiculo_id === 'otro'
    const vehiculoSeleccionado = !esOtro ? vehiculos.find(v => v.id === formVehiculo.vehiculo_id) : null
    const payload = {
      chofer_email: email,
      chofer_nombre: persona?.nombre || null,
      tipo,
      fecha: getFechaMexico(),
      checada_id: checadaId ? String(checadaId) : null,
      vehiculo_id: vehiculoSeleccionado?.id || null,
      vehiculo_nombre: validado.nombreVehiculo || vehiculoActual?.vehiculo_nombre || 'Vehículo no especificado',
      vehiculo_anterior_id: tipo === 'cambio_vehiculo' ? (vehiculoActual?.vehiculo_id || null) : null,
      vehiculo_anterior_nombre: tipo === 'cambio_vehiculo' ? (vehiculoActual?.vehiculo_nombre || null) : null,
      kilometraje: validado.km,
      gasolina: formVehiculo.gasolina || null,
      condicion: formVehiculo.condicion || null,
      observaciones: formVehiculo.observaciones || null,
      foto_tablero_url: fotoUrl,
      lat,
      lng,
    }

    if (tipo === 'regreso_vehiculo' && vehiculoActual) {
      payload.vehiculo_id = vehiculoActual.vehiculo_id || payload.vehiculo_id
      payload.vehiculo_nombre = vehiculoActual.vehiculo_nombre || payload.vehiculo_nombre
      payload.vehiculo_anterior_id = vehiculoActual.vehiculo_id || null
      payload.vehiculo_anterior_nombre = vehiculoActual.vehiculo_nombre || null
    }

    const { error } = await supabase.from('checador_vehiculos_movimientos').insert(payload)
    if (error) {
      showToast('Error vehículo: ' + error.message, false)
      return { ok: false }
    }

    setFormVehiculo(FORM_VEHICULO_INICIAL)
    await loadMovimientosVehiculo()
    return { ok: true }
  }

  const cambiarVehiculo = async () => {
    if (!persona || persona.rol !== 'chofer') return
    setGuardandoVehiculo(true)
    let lat = null, lng = null
    try {
      const gps = await obtenerGPS()
      lat = gps.lat; lng = gps.lng
    } catch (e) {
      showToast('⚠️ Debes habilitar el GPS para cambiar vehículo', false)
      setGuardandoVehiculo(false)
      return
    }
    const res = await registrarMovimientoVehiculo('cambio_vehiculo', { lat, lng })
    if (res.ok) showToast('🚗 Cambio de vehículo registrado')
    setGuardandoVehiculo(false)
  }

  const checar = async (tipo) => {
    if (!persona) return
    setGuardando(true)
    const hoy = getFechaMexico()
    let lat = null, lng = null
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, enableHighAccuracy: true }))
      lat = pos.coords.latitude; lng = pos.coords.longitude
    } catch (e) {
      showToast('⚠️ Debes habilitar el GPS para poder checar', false)
      setGuardando(false)
      return
    }

    // Alerta de llaves al checar salida
    if (tipo === 'salida') {
      const misLlaves = llaves.filter(l => l.portador_email === email && !l.en_resguardo)
      if (misLlaves.length > 0) {
        const nombres = misLlaves.map(l => `#${l.numero} ${l.propiedad}`).join(', ')
        if (!confirm(`⚠️ Tienes ${misLlaves.length} llave(s) en tu poder:\n${nombres}\n\n¿Ya las devolviste?`)) {
          setGuardando(false)
          return
        }
      }
    }

    // Validar ubicación
    const dist = distanciaMetros(lat, lng, OFICINA_LAT, OFICINA_LNG)
    if (persona.rol !== 'chofer') {
      if (dist > RADIO_METROS) {
        showToast(`📍 Estás a ${Math.round(dist)}m de la oficina. No puedes checar desde aquí.`, false)
        setGuardando(false)
        return
      }
    }

    // Detectar si llega tarde
    const horaLimite = tipo === 'junta' ? '10:00' : (horaEsperada || '09:00')
    const tolerancia = tipo === 'junta' ? 0 : 15
    const [hLim, mLim] = horaLimite.split(':').map(Number)
    const limiteConTolerancia = hLim * 60 + mLim + tolerancia
    const [hAct, mAct] = getHoraMexico().split(':').map(Number)
    const minutosActual = hAct * 60 + mAct
    const llegaTardeAhora = tipo !== 'salida' && minutosActual > limiteConTolerancia

    if (persona.rol === 'chofer') {
      const requiereVehiculo = tipo === 'entrada' || !vehiculoActual || necesitaSeleccionarVehiculo
      const validado = validarFormVehiculo({ requiereVehiculo })
      if (!validado) {
        setGuardando(false)
        return
      }
    }

    const { data: checadaRegistrada, error: errorChecada } = await supabase.from('checadas').insert({
      email, nombre: persona.nombre, tipo, fecha: hoy, lat, lng,
      tiene_cita: tipo === 'entrada' ? tieneCita : false,
      llego_tarde: llegaTardeAhora,
      motivo_tarde: llegaTardeAhora ? (tieneCita ? 'Cita con cliente' : motivoTarde) : null,
    }).select('id').single()

    if (errorChecada) {
      showToast('Error: ' + errorChecada.message, false)
      setGuardando(false)
      return
    }

    if (persona.rol === 'chofer' && tipo !== 'junta') {
      const tipoVehiculo = tipo === 'entrada' ? 'toma_vehiculo' : 'regreso_vehiculo'
      const requiereVehiculo = tipo === 'entrada' || !vehiculoActual || necesitaSeleccionarVehiculo
      const vehiculoRes = await registrarMovimientoVehiculo(tipoVehiculo, { lat, lng, checadaId: checadaRegistrada?.id, requiereVehiculo })
      if (!vehiculoRes.ok) {
        setGuardando(false)
        return
      }
    }

    // Notificación en tiempo real si llegó tarde o tiene cita
    if ((llegaTardeAhora || tieneCita) && tipo !== 'salida') {
      try {
        await fetch('/api/notif-checada', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: persona.nombre,
            tipo,
            hora: getHoraMexico(),
            tieneCita,
            llegaTarde: llegaTardeAhora,
            motivo: tieneCita ? 'Cita con cliente' : motivoTarde,
            horaEsperada: horaLimite,
          })
        })
      } catch(e) { /* silencioso */ }
    }

    showToast(tipo === 'entrada' ? '🟢 Entrada registrada' : tipo === 'salida' ? '🔴 Salida registrada' : '📅 Junta registrada')
    setGuardando(false)
    setMotivoTarde('')
    loadChecadasHoy(); loadHistorial()
    if (persona.rol === 'chofer') loadMovimientosVehiculo()
    if (esAdmin || esCarlos) loadChecadasAdmin()
  }

  // ── LLAVES ──
  const loadLlaves = async () => {
    const { data } = await supabase.from('llaves').select('*').eq('activa', true).order('numero', { ascending: true })
    setLlaves(data || [])
  }

  const loadMovimientos = async () => {
    const { data } = await supabase.from('llaves_movimientos').select('*').order('timestamp', { ascending: false }).limit(60)
    setMovimientos(data || [])
  }

  const [movimientosBajas, setMovimientosBajas] = useState([])

  const loadLlavesInactivas = async () => {
    const [{ data: inactivas }, { data: bajas }] = await Promise.all([
      supabase.from('llaves').select('*').eq('activa', false).order('created_at', { ascending: false }),
      supabase.from('llaves_movimientos').select('*').eq('tipo', 'baja').order('timestamp', { ascending: false }),
    ])
    setLlavesInactivas(inactivas || [])
    setMovimientosBajas(bajas || [])
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

  const subirFotoLlave = async (llave, file) => {
    if (!file) return
    setUploadingFoto(llave.id)
    try {
      const ext = file.name.split('.').pop()
      const fileName = `llave_${llave.numero}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('llaves-fotos').upload(fileName, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('llaves-fotos').getPublicUrl(fileName)
      await supabase.from('llaves').update({ foto_url: publicUrl }).eq('id', llave.id)
      showToast('📷 Foto guardada ✅')
      loadLlaves()
    } catch (e) { showToast('Error: ' + e.message, false) }
    setUploadingFoto(null)
  }

  // Prestar (Carlos, Guillermo, Tania → a cualquiera)
  const prestarLlave = async (llave) => {
    const paraEmail = formPrestamo.tipo_receptor === 'personal' ? formPrestamo.para_email : null
    const esCandado = formPrestamo.tipo_receptor === 'candado'
    const paraNombre = formPrestamo.tipo_receptor === 'personal'
      ? (listaPersonas.find(p => p.email === formPrestamo.para_email)?.nombre || '')
      : esCandado
        ? `🔒 Candado — ${formPrestamo.nombre_externo}${formPrestamo.codigo_candado ? ` (${formPrestamo.codigo_candado})` : ''}`
        : formPrestamo.nombre_externo
    if (!paraNombre || paraNombre === '🔒 Candado — ') return
    setSavingLlave(true)
    const { error } = await supabase.from('llaves').update({
      en_resguardo: false,
      portador_email: paraEmail,
      portador_nombre: paraNombre,
      fecha_prestamo: new Date().toISOString(),
    }).eq('id', llave.id)
    if (!error) {
      await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id, numero: llave.numero, propiedad: llave.propiedad,
        tipo: 'prestamo',
        de_email: email, de_nombre: persona?.nombre || 'Admin',
        para_email: paraEmail, para_nombre: paraNombre,
        notas: formPrestamo.notas,
      })
      showToast(`🔑 Llave #${llave.numero} prestada a ${paraNombre}`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalPrestamo(null)
    setFormPrestamo({ tipo_receptor: 'personal', para_email: '', nombre_externo: '', codigo_candado: '', notas: '' })
    loadLlaves(); loadMovimientos()
  }

  // Tomar (asesor se la asigna a sí mismo)
  const tomarLlave = async (llave) => {
    setSavingLlave(true)
    const { error } = await supabase.from('llaves').update({
      en_resguardo: false,
      portador_email: email,
      portador_nombre: persona?.nombre,
      fecha_prestamo: new Date().toISOString(),
    }).eq('id', llave.id)
    if (!error) {
      await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id, numero: llave.numero, propiedad: llave.propiedad,
        tipo: 'prestamo',
        de_email: llave.portador_email, de_nombre: llave.portador_nombre,
        para_email: email, para_nombre: persona?.nombre,
        notas: formTomar.notas,
      })
      showToast(`🔑 Llave #${llave.numero} tomada`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalTomar(null)
    setFormTomar({ notas: '' })
    loadLlaves(); loadMovimientos()
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
        llave_id: llave.id, numero: llave.numero, propiedad: llave.propiedad,
        tipo: 'devolucion',
        de_email: llave.portador_email, de_nombre: llave.portador_nombre,
        para_email: 'asistente1@emporioinmobiliario.mx', para_nombre: 'Tania',
      })
      showToast(`✅ Llave #${llave.numero} devuelta a Tania`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalDevolver(null)
    loadLlaves(); loadMovimientos()
  }

  const traspasarLlave = async (llave) => {
    const paraEmail = formTraspaso.tipo_receptor === 'personal' ? formTraspaso.para_email : null
    const paraNombre = formTraspaso.tipo_receptor === 'personal'
      ? (listaPersonas.find(p => p.email === formTraspaso.para_email)?.nombre || '')
      : formTraspaso.nombre_externo
    if (!paraNombre) return
    setSavingLlave(true)
    const { error } = await supabase.from('llaves').update({
      portador_email: paraEmail,
      portador_nombre: paraNombre,
      fecha_prestamo: new Date().toISOString(),
    }).eq('id', llave.id)
    if (!error) {
      await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id, numero: llave.numero, propiedad: llave.propiedad,
        tipo: 'traspaso',
        de_email: llave.portador_email, de_nombre: llave.portador_nombre,
        para_email: paraEmail, para_nombre: paraNombre,
        notas: formTraspaso.notas,
      })
      showToast(`↔️ Llave #${llave.numero} traspasada a ${paraNombre}`)
    } else { showToast('Error: ' + error.message, false) }
    setSavingLlave(false)
    setShowModalTraspaso(null)
    setFormTraspaso({ tipo_receptor: 'personal', para_email: '', nombre_externo: '', codigo_candado: '', notas: '' })
    loadLlaves(); loadMovimientos()
  }

  const darDeBajaLlave = async (llave) => {
    setSavingLlave(true)
    const nombreBaja = persona?.nombre || (esCarlos ? 'Carlos' : esAdmin ? 'Guillermo' : 'Admin')
    const { error: errorBaja } = await supabase.from('llaves').update({ activa: false }).eq('id', llave.id)
    if (!errorBaja) {
      const { error: errorMov } = await supabase.from('llaves_movimientos').insert({
        llave_id: llave.id,
        numero: llave.numero,
        propiedad: llave.propiedad,
        tipo: 'baja',
        de_email: email,
        de_nombre: nombreBaja,
        para_email: null,
        para_nombre: null,
        notas: `${formBaja.motivo}${formBaja.receptor ? ' — Entregada a: ' + formBaja.receptor : ''}${formBaja.notas ? ' — ' + formBaja.notas : ''}`,
      })
      if (errorMov) { showToast('Error registrando movimiento: ' + errorMov.message, false) }
      else { showToast(`Llave #${llave.numero} dada de baja`) }
    } else { showToast('Error: ' + errorBaja.message, false) }
    setSavingLlave(false)
    setShowModalBaja(null)
    setFormBaja({ motivo: MOTIVOS_BAJA[0], receptor: '', notas: '' })
    loadLlaves(); loadMovimientos()
  }

  const guardarGuardia = async () => {
    if (!formGuardia.email || !formGuardia.fecha) return
    const p = listaPersonas.find(per => per.email === formGuardia.email)
    if (!p) return
    const { error } = await supabase.from('guardias').upsert({ email: formGuardia.email, nombre: p.nombre, fecha_guardia: formGuardia.fecha }, { onConflict: 'email,fecha_guardia' })
    if (error) { showToast('Error: ' + error.message, false); return }
    showToast(`Guardia asignada a ${p.nombre}`)
    setShowModalGuardia(false)
    setFormGuardia({ email: '', fecha: '' })
    loadGuardiasAdmin()
  }

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 48, opacity: 0.4 }} />
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

  const llavesConAlerta = llaves.filter(l => !l.en_resguardo && diasFuera(l.fecha_prestamo) >= 1)

  const llavesDisponibles = llaves.filter(l => {
    if (busquedaLlave) return l.propiedad.toLowerCase().includes(busquedaLlave.toLowerCase()) || l.numero.toString().includes(busquedaLlave)
    if (filtroLlave === 'resguardo') return l.en_resguardo
    if (filtroLlave === 'prestadas') return !l.en_resguardo
    if (filtroLlave === 'mias') return l.portador_email === email
    return true
  })

  const horaEsperada = getHoraEsperada()
  const horaActual = getHoraMexico()
  const llegoATiempo = yaEntro && checadasHoy[0]?.timestamp &&
    new Date(checadasHoy[0].timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }) <= (horaEsperada || '09:15')

  const TABS = []
  if (!soloLlaves && persona) TABS.push({ id: 'checador', label: '⏰ Checador' })
  TABS.push({ id: 'llaves', label: '🔑 Llaves' })
  if (esAdmin || esCarlos) TABS.push({ id: 'admin', label: '📊 Admin' })

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

        {/* Alerta llaves vencidas */}
        {llavesConAlerta.length > 0 && (
          <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '10px 20px' }}>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#92400e' }}>
                ⚠️ {llavesConAlerta.length} llave(s) fuera de resguardo por más de 1 día:
              </p>
              {llavesConAlerta.map(l => (
                <p key={l.id} style={{ margin: '2px 0 0', fontSize: 12, color: '#92400e' }}>
                  #{l.numero} {l.propiedad} — con {l.portador_nombre} ({diasFuera(l.fecha_prestamo)} días)
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 20px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ flex: 1, padding: '14px 8px', border: 'none', borderBottom: `2px solid ${tab === t.id ? '#b91c3c' : 'transparent'}`, background: 'transparent', color: tab === t.id ? '#b91c3c' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' }}>

          {/* ── TAB CHECADOR ── */}
          {tab === 'checador' && !soloLlaves && persona && (
            <div>
              <div style={{ background: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, border: '1px solid #e5e7eb' }}>
                <p style={{ margin: '0 0 8px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                  {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })}
                </p>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {horaEsperada && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>Entrada esperada</p>
                      <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>{horaEsperada}</p>
                    </div>
                  )}
                  {yaEntro && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>Tu entrada</p>
                      <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: llegoATiempo ? '#065f46' : '#dc2626' }}>
                        {fmt12(checadasHoy[0]?.timestamp)} {llegoATiempo ? '✅' : '⚠️'}
                      </p>
                    </div>
                  )}
                  {yaSalio && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>Tu salida</p>
                      <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#374151' }}>
                        {fmt12(checadasHoy.filter(c => c.tipo === 'salida').pop()?.timestamp)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {persona.rol === 'chofer' && (
                <div style={{ background: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, border: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>🚗 Control de vehículo</p>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#374151', fontWeight: 700 }}>
                        {vehiculoActual ? `Actual: ${vehiculoActual.vehiculo_nombre}` : 'Toma vehículo para iniciar ruta'}
                      </p>
                    </div>
                    {vehiculoActual && (
                      <span style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 999, padding: '5px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        En ruta
                      </span>
                    )}
                  </div>

                  {!vehiculosDisponibles && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                      <p style={{ margin: 0, color: '#991b1b', fontSize: 12, fontWeight: 700 }}>
                        Falta crear la tabla/bucket de vehículos en Supabase. Ejecuta el SQL de control vehicular.
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'grid', gap: 10 }}>
                    {(!vehiculoActual || formVehiculo.vehiculo_id || formVehiculo.vehiculo_nombre_manual) && (
                      <>
                        <select value={formVehiculo.vehiculo_id} onChange={e => setFormVehiculo(f => ({ ...f, vehiculo_id: e.target.value, vehiculo_nombre_manual: e.target.value === 'otro' ? f.vehiculo_nombre_manual : '' }))}
                          style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                          <option value="">Selecciona vehículo...</option>
                          {vehiculos.map(v => (
                            <option key={v.id} value={v.id}>{v.nombre}{v.placas ? ` · ${v.placas}` : ''}</option>
                          ))}
                          <option value="otro">Otro vehículo / apoyo familiar</option>
                        </select>
                        {formVehiculo.vehiculo_id === 'otro' && (
                          <input value={formVehiculo.vehiculo_nombre_manual} onChange={e => setFormVehiculo(f => ({ ...f, vehiculo_nombre_manual: e.target.value }))}
                            placeholder="Ej: Auto Carlos, camioneta Karla, vehículo familiar..."
                            style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                        )}
                      </>
                    )}

                    {vehiculoActual && !formVehiculo.vehiculo_id && !formVehiculo.vehiculo_nombre_manual && (
                      <button onClick={() => setFormVehiculo(f => ({ ...f, vehiculo_id: 'otro' }))}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                        Cambiar a otro vehículo
                      </button>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input value={formVehiculo.kilometraje} onChange={e => setFormVehiculo(f => ({ ...f, kilometraje: e.target.value.replace(/\D/g, '') }))}
                        inputMode="numeric"
                        placeholder={vehiculoActual && !formVehiculo.vehiculo_id ? 'Km final' : 'Km inicial'}
                        style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                      <select value={formVehiculo.gasolina} onChange={e => setFormVehiculo(f => ({ ...f, gasolina: e.target.value }))}
                        style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                        <option value="">Gasolina/batería</option>
                        <option value="vacio">Vacío</option>
                        <option value="1/4">1/4</option>
                        <option value="1/2">1/2</option>
                        <option value="3/4">3/4</option>
                        <option value="lleno">Lleno</option>
                      </select>
                    </div>

                    <select value={formVehiculo.condicion} onChange={e => setFormVehiculo(f => ({ ...f, condicion: e.target.value }))}
                      style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                      <option value="bien">Sin detalles visibles</option>
                      <option value="detalle_menor">Detalle menor</option>
                      <option value="requiere_revision">Requiere revisión</option>
                      <option value="incidencia">Incidencia</option>
                    </select>

                    <label style={{ display: 'block', border: `1.5px dashed ${formVehiculo.foto_tablero ? '#86efac' : '#cbd5e1'}`, background: formVehiculo.foto_tablero ? '#f0fdf4' : '#f8fafc', borderRadius: 12, padding: 12, cursor: 'pointer' }}>
                      <input type="file" accept="image/*" capture="environment" onChange={e => setFormVehiculo(f => ({ ...f, foto_tablero: e.target.files?.[0] || null }))}
                        style={{ display: 'none' }} />
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: formVehiculo.foto_tablero ? '#065f46' : '#475569' }}>
                        📷 {formVehiculo.foto_tablero ? 'Foto del tablero lista' : 'Foto del tablero (km y gasolina/batería)'}
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: 11, color: '#64748b' }}>
                        Debe verse el kilometraje y el marcador del tanque o batería.
                      </p>
                    </label>

                    <textarea value={formVehiculo.observaciones} onChange={e => setFormVehiculo(f => ({ ...f, observaciones: e.target.value }))}
                      placeholder="Observaciones opcionales: destino, apoyo familiar, detalle del auto..."
                      rows={2}
                      style={{ width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }} />

                    {vehiculoActual && (formVehiculo.vehiculo_id || formVehiculo.vehiculo_nombre_manual) && (
                      <button onClick={cambiarVehiculo} disabled={guardandoVehiculo || guardando}
                        style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', background: guardandoVehiculo ? '#e5e7eb' : '#1e40af', color: guardandoVehiculo ? '#9ca3af' : '#fff', fontSize: 14, fontWeight: 900, cursor: guardandoVehiculo ? 'not-allowed' : 'pointer' }}>
                        🔁 Registrar cambio de vehículo
                      </button>
                    )}
                  </div>

                  {movimientosVehiculo.length > 0 && (
                    <div style={{ marginTop: 14, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                      <p style={{ margin: '0 0 8px', fontSize: 11, color: '#9ca3af', fontWeight: 800, textTransform: 'uppercase' }}>Últimos movimientos</p>
                      {movimientosVehiculo.slice(0, 3).map(m => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderBottom: '1px solid #f9fafb' }}>
                          <div>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#374151' }}>
                              {m.tipo === 'regreso_vehiculo' ? '🏁 Devolución' : m.tipo === 'cambio_vehiculo' ? '🔁 Cambio' : '🚗 Toma'} · {m.vehiculo_nombre}
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>{fmt12(m.created_at)} · {m.gasolina || '—'}</p>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 900, color: '#1a1a2e' }}>{Number(m.kilometraje || 0).toLocaleString('es-MX')} km</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {persona.rol === 'asesor' && !tieneGuardiaHoy() && !esJuntaHoy() && (
                <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 16, marginBottom: 14, textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#92400e' }}>No tienes guardia hoy</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#92400e' }}>Tu guardia será asignada por Guillermo o Carlos</p>
                </div>
              )}

              {esJuntaHoy() && (persona.rol === 'asesor' || persona.rol === 'gerente') && (
                <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e40af' }}>📅 Junta de equipo hoy</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#1e40af' }}>10:00 AM · Tolerancia 0 minutos</p>
                </div>
              )}

              {persona.rol === 'asesor' && tieneGuardiaHoy() && !yaEntro && (() => {
                const [hLim, mLim] = ((horaEsperada || '09:00')).split(':').map(Number)
                const limiteMin = hLim * 60 + mLim + 15
                const [hAct, mAct] = getHoraMexico().split(':').map(Number)
                const esTarde = hAct * 60 + mAct > limiteMin
                return (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={tieneCita} onChange={e => { setTieneCita(e.target.checked); if (e.target.checked) setMotivoTarde('') }} style={{ width: 18, height: 18 }} />
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#374151' }}>Tengo cita este día</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>Justifica llegada después de las 9:15</p>
                      </div>
                    </label>
                    {esTarde && !tieneCita && (
                      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 14 }}>
                        <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#92400e' }}>⚠️ Estás llegando tarde — indica el motivo</p>
                        <input value={motivoTarde} onChange={e => setMotivoTarde(e.target.value)}
                          placeholder="Ej: Tráfico, emergencia familiar..."
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #fcd34d', fontSize: 14, boxSizing: 'border-box' }} />
                      </div>
                    )}
                  </div>
                )
              })()}

              {puedeChecar() && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {esJuntaHoy() && (persona.rol === 'asesor' || persona.rol === 'gerente') && !yaChecoJunta && (() => {
                    const [hAct, mAct] = getHoraMexico().split(':').map(Number)
                    const tardeFuera = hAct * 60 + mAct > 10 * 60 // después de 10:00 AM exacto
                    return (
                      <div>
                        {tardeFuera && (
                          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: 14, marginBottom: 8 }}>
                            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#92400e' }}>⚠️ Llegaste tarde a la junta — indica el motivo</p>
                            <input value={motivoTarde} onChange={e => setMotivoTarde(e.target.value)}
                              placeholder="Ej: Tráfico, cita previa..."
                              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #fcd34d', fontSize: 14, boxSizing: 'border-box' }} />
                          </div>
                        )}
                        <button onClick={() => checar('junta')} disabled={guardando || (tardeFuera && !motivoTarde)}
                          style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: tardeFuera && !motivoTarde ? '#e5e7eb' : '#1e40af', color: tardeFuera && !motivoTarde ? '#9ca3af' : '#fff', fontSize: 16, fontWeight: 800, cursor: guardando || (tardeFuera && !motivoTarde) ? 'not-allowed' : 'pointer' }}>
                          📅 Registrar asistencia a junta
                        </button>
                      </div>
                    )
                  })()}
                  {(tieneGuardiaHoy() || persona.rol === 'staff' || persona.rol === 'chofer') && !yaEntro && (
                    <button onClick={() => checar('entrada')} disabled={guardando}
                      style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: '#065f46', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
                      🟢 Registrar Entrada
                    </button>
                  )}
                  {(tieneGuardiaHoy() || persona.rol === 'staff' || persona.rol === 'chofer') && yaEntro && !yaSalio && (
                    <button onClick={() => checar('salida')} disabled={guardando}
                      style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: '#b91c3c', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
                      🔴 Registrar Salida
                    </button>
                  )}
                  {yaEntro && yaSalio && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#065f46' }}>✅ Checadas completas del día</p>
                    </div>
                  )}
                </div>
              )}

              {historial.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Últimas checadas</p>
                  {historial.slice(0, 10).map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: c.tipo === 'entrada' ? '#065f46' : c.tipo === 'salida' ? '#b91c3c' : '#1e40af' }}>
                          {c.tipo === 'entrada' ? '🟢' : c.tipo === 'salida' ? '🔴' : '📅'} {c.tipo}
                        </span>
                        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>{fmtFecha(c.fecha)}</span>
                        {c.tiene_cita && <span style={{ fontSize: 10, color: '#7c3aed', marginLeft: 6, fontWeight: 600 }}>· con cita</span>}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt12(c.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB LLAVES ── */}
          {tab === 'llaves' && (
            <div>
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

              {(esAdmin || esCarlos || email === 'asistente1@emporioinmobiliario.mx') && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button onClick={() => setShowModalLlave(true)}
                    style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px dashed #b91c3c', background: '#fff0f3', color: '#b91c3c', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    + Nueva llave
                  </button>
                  <button onClick={() => { setShowHistorialBajas(true); loadLlavesInactivas() }}
                    style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', color: '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    🗂️ Bajas
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {llavesDisponibles.map(llave => {
                  const esMia = llave.portador_email === email
                  const enResguardo = llave.en_resguardo
                  const alerta = !enResguardo && diasFuera(llave.fecha_prestamo) >= 1
                  return (
                    <div key={llave.id} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `1px solid ${alerta ? '#fcd34d' : esMia ? '#fca5a5' : '#e5e7eb'}`, borderLeft: `4px solid ${alerta ? '#f59e0b' : esMia ? '#b91c3c' : enResguardo ? '#065f46' : '#f59e0b'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ background: '#1a1a2e', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 14, fontWeight: 900 }}>#{llave.numero}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{llave.propiedad}</span>
                          </div>
                          <p style={{ margin: 0, fontSize: 12, color: enResguardo ? '#065f46' : esMia ? '#b91c3c' : '#92400e', fontWeight: 600 }}>
                            {enResguardo ? '✅ En resguardo (Tania)' : esMia ? '🔑 La tienes tú' : `📍 Con ${llave.portador_nombre}`}
                          </p>
                          {!enResguardo && llave.fecha_prestamo && (
                            <p style={{ margin: '2px 0 0', fontSize: 11, color: alerta ? '#dc2626' : '#9ca3af', fontWeight: alerta ? 700 : 400 }}>
                              {alerta ? `⚠️ ${diasFuera(llave.fecha_prestamo)} días fuera` : `Desde ${new Date(llave.fecha_prestamo).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`}
                            </p>
                          )}
                          {llave.notas && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>{llave.notas}</p>}
                        </div>
                      </div>
                      {llave.foto_url && (
                        <div style={{ marginBottom: 8 }}>
                          <img src={llave.foto_url} alt={`Llave #${llave.numero}`}
                            style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer' }}
                            onClick={() => window.open(llave.foto_url, '_blank')} />
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {/* Prestar — solo Carlos, Guillermo, Tania */}
                        {puedePrestar && enResguardo && (
                          <button onClick={() => setShowModalPrestamo(llave)}
                            style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            🔑 Prestar
                          </button>
                        )}
                        {/* Tomar — asesores y staff cuando está en resguardo */}
                        {!puedePrestar && enResguardo && (
                          <button onClick={() => setShowModalTomar(llave)}
                            style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            🔑 Tomar
                          </button>
                        )}
                        {/* Devolver — quien la tiene o admins */}
                        {!enResguardo && (esMia || puedePrestar) && (
                          <button onClick={() => setShowModalDevolver(llave)}
                            style={{ background: '#f0fdf4', color: '#065f46', border: '1px solid #86efac', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            ✅ Devolver
                          </button>
                        )}
                        {/* Traspasar — quien la tiene */}
                        {!enResguardo && (esMia || puedePrestar) && (
                          <button onClick={() => setShowModalTraspaso(llave)}
                            style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            ↔️ Traspasar
                          </button>
                        )}
                        {/* Dar de baja — solo admins y Tania */}
                        {(esAdmin || esCarlos || email === 'asistente1@emporioinmobiliario.mx') && (
                          <button onClick={() => setShowModalBaja(llave)}
                            style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            Dar de baja
                          </button>
                        )}
                        {/* Foto — admins y Tania */}
                        {(esAdmin || esCarlos || email === 'asistente1@emporioinmobiliario.mx') && (
                          <label style={{ cursor: 'pointer' }}>
                            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                              onChange={e => e.target.files[0] && subirFotoLlave(llave, e.target.files[0])} />
                            <span style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 700, display: 'inline-block', cursor: 'pointer' }}>
                              {uploadingFoto === llave.id ? '⏳' : llave.foto_url ? '📷 Actualizar' : '📷 Foto'}
                            </span>
                          </label>
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

              {/* Historial de movimientos mejorado */}
              <div style={{ background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #e5e7eb', marginTop: 16 }}>
                <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Historial de movimientos</p>
                
                {/* Filtros */}
                <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                  <input placeholder="Buscar # o propiedad..." value={filtroMovBusqueda} onChange={e => { setFiltroMovBusqueda(e.target.value); setMovsPagina(1) }}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select value={filtroMovTipo} onChange={e => { setFiltroMovTipo(e.target.value); setMovsPagina(1) }}
                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, background: '#fff' }}>
                      <option value="todos">Todos los tipos</option>
                      <option value="prestamo">🔑 Préstamos</option>
                      <option value="devolucion">✅ Devoluciones</option>
                      <option value="traspaso">↔️ Traspasos</option>
                      <option value="baja">🗂️ Bajas</option>
                    </select>
                    <select value={filtroMovPersona} onChange={e => { setFiltroMovPersona(e.target.value); setMovsPagina(1) }}
                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, background: '#fff' }}>
                      <option value="todos">Todas las personas</option>
                      {listaPersonas.map(p => (
                        <option key={p.nombre} value={p.nombre}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {(() => {
                  const movsFiltrados = movimientos.filter(m => {
                    if (filtroMovTipo !== 'todos' && m.tipo !== filtroMovTipo) return false
                    if (filtroMovPersona !== 'todos' && m.de_nombre !== filtroMovPersona && m.para_nombre !== filtroMovPersona) return false
                    if (filtroMovBusqueda) {
                      const q = filtroMovBusqueda.toLowerCase()
                      if (!m.propiedad?.toLowerCase().includes(q) && !m.numero?.toString().includes(q)) return false
                    }
                    return true
                  })
                  const totalPaginas = Math.ceil(movsFiltrados.length / MOVS_POR_PAGINA)
                  const movsEnPagina = movsFiltrados.slice((movsPagina - 1) * MOVS_POR_PAGINA, movsPagina * MOVS_POR_PAGINA)

                  return (
                    <>
                      {movsFiltrados.length === 0 ? (
                        <p style={{ textAlign: 'center', color: '#9ca3af', padding: 20, fontSize: 13 }}>Sin movimientos</p>
                      ) : (
                        <>
                          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#9ca3af' }}>{movsFiltrados.length} movimiento(s)</p>
                          {movsEnPagina.map((m, i) => (
                            <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                    <span style={{ background: '#1a1a2e', color: '#fff', borderRadius: 5, padding: '1px 6px', fontSize: 11, fontWeight: 900 }}>#{m.numero}</span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{m.propiedad}</span>
                                    <span style={{ fontSize: 10, background: m.tipo === 'devolucion' ? '#f0fdf4' : m.tipo === 'baja' ? '#f3f4f6' : m.tipo === 'prestamo' ? '#fff0f3' : '#fffbeb', color: m.tipo === 'devolucion' ? '#065f46' : m.tipo === 'baja' ? '#6b7280' : m.tipo === 'prestamo' ? '#b91c3c' : '#92400e', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>
                                      {m.tipo === 'prestamo' ? '🔑 préstamo' : m.tipo === 'devolucion' ? '✅ devolución' : m.tipo === 'baja' ? '🗂️ baja' : '↔️ traspaso'}
                                    </span>
                                  </div>
                                  <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>
                                    {m.tipo === 'baja' ? `${m.notas}` : `${m.de_nombre} → ${m.para_nombre}`}
                                  </p>
                                  {m.notas && m.tipo !== 'baja' && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>{m.notas}</p>}
                                </div>
                                <div style={{ textAlign: 'right', minWidth: 80 }}>
                                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#374151' }}>{fmt12(m.timestamp)}</p>
                                  <p style={{ margin: 0, fontSize: 10, color: '#9ca3af' }}>{new Date(m.timestamp).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</p>
                                </div>
                              </div>
                            </div>
                          ))}

                          {/* Paginación */}
                          {totalPaginas > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
                              <button onClick={() => setMovsPagina(p => Math.max(1, p - 1))} disabled={movsPagina === 1}
                                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: movsPagina === 1 ? 'not-allowed' : 'pointer', color: movsPagina === 1 ? '#d1d5db' : '#374151', fontSize: 13, fontWeight: 700 }}>
                                ←
                              </button>
                              <span style={{ fontSize: 12, color: '#6b7280' }}>{movsPagina} / {totalPaginas}</span>
                              <button onClick={() => setMovsPagina(p => Math.min(totalPaginas, p + 1))} disabled={movsPagina === totalPaginas}
                                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: movsPagina === totalPaginas ? 'not-allowed' : 'pointer', color: movsPagina === totalPaginas ? '#d1d5db' : '#374151', fontSize: 13, fontWeight: 700 }}>
                                →
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
          )}

          {/* ── TAB ADMIN ── */}
          {tab === 'admin' && (esAdmin || esCarlos) && (
            <div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {[['hoy', '📍 Hoy'], ['semana', '📅 Semana'], ['vehiculos', '🚗 Vehículos'], ['guardias', '🗓️ Guardias']].map(([id, label]) => (
                  <button key={id} onClick={() => setVistaAdmin(id)}
                    style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${vistaAdmin === id ? '#b91c3c' : '#e5e7eb'}`, background: vistaAdmin === id ? '#fff0f3' : '#fff', color: vistaAdmin === id ? '#b91c3c' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>

              {vistaAdmin === 'hoy' && (
                <div>
                  <p style={{ margin: '0 0 12px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                    {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })}
                  </p>
                  {listaPersonas.filter(p => p.rol !== 'admin').map(({ nombre }) => {
                    const hoy = getFechaMexico()
                    const checadasPersona = checadasAdmin.filter(c => c.nombre === nombre && c.fecha === hoy)
                    const entrada = checadasPersona.find(c => c.tipo === 'entrada')
                    const salida = checadasPersona.find(c => c.tipo === 'salida')
                    const junta = checadasPersona.find(c => c.tipo === 'junta')
                    const checaron = checadasPersona.length > 0
                    return (
                      <div key={nombre} style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 8, border: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: checaron ? '#065f46' : '#e5e7eb' }} />
                          <span style={{ fontSize: 14, fontWeight: 700, color: checaron ? '#374151' : '#9ca3af' }}>{nombre}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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

              {vistaAdmin === 'semana' && (
                <div>
                  <p style={{ margin: '0 0 12px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Últimos 30 días</p>
                  <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f9fafb' }}>
                          {['Persona', 'Fecha', 'Tipo', 'Hora'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {checadasAdmin.slice(0, 50).map((c, i) => (
                          <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600 }}>{c.nombre}</td>
                            <td style={{ padding: '9px 12px', fontSize: 12, color: '#9ca3af' }}>{fmtFecha(c.fecha)}</td>
                            <td style={{ padding: '9px 12px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: c.tipo === 'entrada' ? '#065f46' : c.tipo === 'salida' ? '#b91c3c' : '#1e40af' }}>
                                {c.tipo === 'entrada' ? '🟢' : c.tipo === 'salida' ? '🔴' : '📅'} {c.tipo}
                                {c.tiene_cita && ' (cita)'}
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

              {vistaAdmin === 'vehiculos' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700 }}>Últimos movimientos de vehículos</p>
                    <button onClick={loadMovimientosVehiculoAdmin}
                      style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#64748b', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      Actualizar
                    </button>
                  </div>
                  {!vehiculosDisponibles && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                      <p style={{ margin: 0, color: '#991b1b', fontSize: 12, fontWeight: 700 }}>No se pudo cargar el control vehicular.</p>
                    </div>
                  )}
                  {movimientosVehiculoAdmin.length === 0 && (
                    <p style={{ textAlign: 'center', color: '#9ca3af', padding: 32 }}>Sin movimientos de vehículos registrados</p>
                  )}
                  <div style={{ display: 'grid', gap: 10 }}>
                    {movimientosVehiculoAdmin.map(m => {
                      const tipoLabel = m.tipo === 'regreso_vehiculo' ? 'Devolución' : m.tipo === 'cambio_vehiculo' ? 'Cambio' : 'Toma'
                      const tipoColor = m.tipo === 'regreso_vehiculo' ? '#b91c3c' : m.tipo === 'cambio_vehiculo' ? '#1e40af' : '#065f46'
                      const mapsUrl = m.lat && m.lng ? `https://www.google.com/maps?q=${m.lat},${m.lng}` : null
                      return (
                        <div key={m.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: 14, fontWeight: 850, color: '#374151' }}>
                                {m.chofer_nombre || m.chofer_email || 'Chofer'} · {m.vehiculo_nombre || 'Vehículo'}
                              </p>
                              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#9ca3af' }}>
                                {fmtFecha(m.fecha)} · {fmt12(m.created_at)}
                              </p>
                            </div>
                            <span style={{ background: `${tipoColor}12`, color: tipoColor, border: `1px solid ${tipoColor}33`, borderRadius: 999, padding: '5px 9px', fontSize: 11, fontWeight: 850 }}>
                              {tipoLabel}
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
                            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 9 }}>
                              <p style={{ margin: 0, fontSize: 10, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>Kilometraje</p>
                              <p style={{ margin: '3px 0 0', fontSize: 13, color: '#334155', fontWeight: 850 }}>{Number(m.kilometraje || 0).toLocaleString('es-MX')} km</p>
                            </div>
                            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 9 }}>
                              <p style={{ margin: 0, fontSize: 10, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>Gasolina/batería</p>
                              <p style={{ margin: '3px 0 0', fontSize: 13, color: '#334155', fontWeight: 850 }}>{m.gasolina || '—'}</p>
                            </div>
                            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 9 }}>
                              <p style={{ margin: 0, fontSize: 10, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>Condición</p>
                              <p style={{ margin: '3px 0 0', fontSize: 13, color: '#334155', fontWeight: 850 }}>{(m.condicion || '—').replace(/_/g, ' ')}</p>
                            </div>
                          </div>

                          {m.tipo === 'cambio_vehiculo' && m.vehiculo_anterior_nombre && (
                            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>
                              Vehículo anterior: <strong>{m.vehiculo_anterior_nombre}</strong>
                            </p>
                          )}
                          {m.observaciones && (
                            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#475569', background: '#f8fafc', borderRadius: 8, padding: 9 }}>
                              {m.observaciones}
                            </p>
                          )}

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                            {m.foto_tablero_url && (
                              <a href={m.foto_tablero_url} target="_blank" rel="noreferrer"
                                style={{ textDecoration: 'none', padding: '7px 10px', borderRadius: 8, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', fontSize: 12, fontWeight: 850 }}>
                                Ver foto
                              </a>
                            )}
                            {mapsUrl && (
                              <a href={mapsUrl} target="_blank" rel="noreferrer"
                                style={{ textDecoration: 'none', padding: '7px 10px', borderRadius: 8, background: '#f0fdf4', color: '#065f46', border: '1px solid #bbf7d0', fontSize: 12, fontWeight: 850 }}>
                                Ver ubicación
                              </a>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {vistaAdmin === 'guardias' && (
                <div>
                  <button onClick={() => setShowModalGuardia(true)}
                    style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px dashed #b91c3c', background: '#fff0f3', color: '#b91c3c', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>
                    + Asignar guardia
                  </button>
                  {guardiasAdmin.length === 0 && <p style={{ textAlign: 'center', color: '#9ca3af', padding: 32 }}>No hay guardias asignadas</p>}
                  {guardiasAdmin.map((g, i) => (
                    <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 8, border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{g.nombre}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>{fmtFecha(g.fecha_guardia)} · 9:00 AM</p>
                      </div>
                      <button onClick={async () => { await supabase.from('guardias').delete().eq('id', g.id); showToast('Eliminada'); loadGuardiasAdmin() }}
                        style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
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
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Número</label>
                  <input type="number" value={formLlave.numero} onChange={e => setFormLlave(f => ({ ...f, numero: e.target.value }))}
                    placeholder="Ej: 42" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Propiedad</label>
                  <input value={formLlave.propiedad} onChange={e => setFormLlave(f => ({ ...f, propiedad: e.target.value }))}
                    placeholder="Nombre de la propiedad" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas</label>
                  <input value={formLlave.notas} onChange={e => setFormLlave(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Ej: Llave azul, copia" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalLlave(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={guardarLlave} disabled={savingLlave || !formLlave.numero || !formLlave.propiedad}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: !formLlave.numero || !formLlave.propiedad ? 0.5 : 1 }}>
                  {savingLlave ? 'Guardando...' : 'Registrar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Prestar (admins) */}
        {showModalPrestamo && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>🔑 Prestar llave #{showModalPrestamo.numero}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>{showModalPrestamo.propiedad}</p>
              <ReceptorForm form={formPrestamo} setForm={setFormPrestamo} excluirEmail={email} listaPersonas={listaPersonas} />
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas</label>
                <input value={formPrestamo.notas} onChange={e => setFormPrestamo(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Ej: Para mostrar hoy" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalPrestamo(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => prestarLlave(showModalPrestamo)} disabled={savingLlave || (formPrestamo.tipo_receptor === 'personal' ? !formPrestamo.para_email : !formPrestamo.nombre_externo)}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: (formPrestamo.tipo_receptor === 'personal' ? !formPrestamo.para_email : !formPrestamo.nombre_externo) ? 0.5 : 1 }}>
                  {savingLlave ? 'Guardando...' : 'Prestar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tomar (asesores/staff) */}
        {showModalTomar && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>🔑 Tomar llave #{showModalTomar.numero}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>{showModalTomar.propiedad}</p>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas (opcional)</label>
                <input value={formTomar.notas} onChange={e => setFormTomar(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Ej: Para mostrar hoy en la tarde" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalTomar(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => tomarLlave(showModalTomar)} disabled={savingLlave}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#1a1a2e', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                  {savingLlave ? 'Registrando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Devolver */}
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
                  {savingLlave ? 'Guardando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Traspasar */}
        {showModalTraspaso && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>↔️ Traspasar llave #{showModalTraspaso.numero}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>{showModalTraspaso.propiedad}</p>
              <ReceptorForm form={formTraspaso} setForm={setFormTraspaso} listaPersonas={listaPersonas} />
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas</label>
                <input value={formTraspaso.notas} onChange={e => setFormTraspaso(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalTraspaso(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => traspasarLlave(showModalTraspaso)} disabled={savingLlave || (formTraspaso.tipo_receptor === 'personal' ? !formTraspaso.para_email : !formTraspaso.nombre_externo)}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#92400e', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                  {savingLlave ? 'Traspasando...' : 'Traspasar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dar de baja */}
        {showModalBaja && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>🗂️ Dar de baja llave #{showModalBaja.numero}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>{showModalBaja.propiedad}</p>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Motivo</label>
                  <select value={formBaja.motivo} onChange={e => setFormBaja(f => ({ ...f, motivo: e.target.value, receptor: MOTIVOS_SIN_RECEPTOR.includes(e.target.value) ? '' : f.receptor }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                    {MOTIVOS_BAJA.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {!MOTIVOS_SIN_RECEPTOR.includes(formBaja.motivo) && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>¿A quién se entrega? *</label>
                    <input value={formBaja.receptor} onChange={e => setFormBaja(f => ({ ...f, receptor: e.target.value }))}
                      placeholder="Nombre del inquilino, propietario, cliente..."
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #1a1a2e', fontSize: 14, boxSizing: 'border-box' }} />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas adicionales</label>
                  <input value={formBaja.notas} onChange={e => setFormBaja(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Opcional" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => setShowModalBaja(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button onClick={() => darDeBajaLlave(showModalBaja)} disabled={savingLlave || (!MOTIVOS_SIN_RECEPTOR.includes(formBaja.motivo) && !formBaja.receptor)}
                  style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: (!MOTIVOS_SIN_RECEPTOR.includes(formBaja.motivo) && !formBaja.receptor) ? '#e5e7eb' : '#dc2626', color: (!MOTIVOS_SIN_RECEPTOR.includes(formBaja.motivo) && !formBaja.receptor) ? '#9ca3af' : '#fff', cursor: (savingLlave || (!MOTIVOS_SIN_RECEPTOR.includes(formBaja.motivo) && !formBaja.receptor)) ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                  {savingLlave ? 'Procesando...' : 'Dar de baja'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Historial bajas */}
        {showHistorialBajas && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflowY: 'auto' }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>🗂️ Historial de bajas</h3>
                <button onClick={() => setShowHistorialBajas(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>✕</button>
              </div>
              {llavesInactivas.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#9ca3af', padding: 32 }}>Sin llaves dadas de baja</p>
              ) : llavesInactivas.map(l => {
                const movBaja = movimientosBajas.find(m => m.numero === l.numero)
                return (
                  <div key={l.id} style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 14px', marginBottom: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ background: '#6b7280', color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 900 }}>#{l.numero}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{l.propiedad}</span>
                    </div>
                    {movBaja ? (
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <div>
                            <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>Dado de baja por</p>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#374151' }}>{movBaja.de_nombre}</p>
                          </div>
                          <div>
                            <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>Fecha y hora</p>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#374151' }}>{new Date(movBaja.timestamp).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} · {fmt12(movBaja.timestamp)}</p>
                          </div>
                        </div>
                        {movBaja.notas && (
                          <div>
                            <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase' }}>Motivo</p>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{movBaja.notas}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 11, color: '#9ca3af' }}>Sin detalle de baja registrado</p>
                    )}
                    {l.notas && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>Nota: {l.notas}</p>}
                  </div>
                )
              })}
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
                    {listaPersonas.filter(p => p.rol === 'asesor').map(p => (
                      <option key={p.email} value={p.email}>{p.nombre}</option>
                    ))}
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
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 56, marginBottom: 24 }} />
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
