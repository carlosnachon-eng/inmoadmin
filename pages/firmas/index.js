import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'
import { usePermiso, SinAcceso } from '../../lib/permisos'

const TIPO_LABELS = {
  firma_arrendamiento: { label: 'Firma arrendamiento', color: '#1a3c5e', bg: '#eff6ff', emoji: '📝' },
  firma_compraventa:   { label: 'Firma compraventa',   color: '#065f46', bg: '#f0fdf4', emoji: '🏠' },
  avaluo:              { label: 'Avalúo',               color: '#92400e', bg: '#fffbeb', emoji: '📊' },
  entrega_llaves:      { label: 'Entrega de llaves',   color: '#7c3aed', bg: '#faf5ff', emoji: '🔑' },
  otro:                { label: 'Otro',                 color: '#6b7280', bg: '#f9fafb', emoji: '📌' },
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

export default function FirmasDashboard() {
  const { cargando: permisoCargando, puedeVer } = usePermiso('firmas')
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [firmas, setFirmas] = useState([])
  const [filtro, setFiltro] = useState('activo')
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('expedientes')
  const [restaurandoFlujos, setRestaurandoFlujos] = useState(false)
  const [resultadoRestauracion, setResultadoRestauracion] = useState(null)

  // Calendario
  const [citas, setCitas] = useState([])
  const [mesActual, setMesActual] = useState(new Date().getMonth())
  const [anioActual, setAnioActual] = useState(new Date().getFullYear())
  const [diaSeleccionado, setDiaSeleccionado] = useState(null)
  const [showModalCita, setShowModalCita] = useState(false)
  const [showModalDetalleDia, setShowModalDetalleDia] = useState(false)
  const [citasDelDia, setCitasDelDia] = useState([])
  const [savingCita, setSavingCita] = useState(false)
  const [formCita, setFormCita] = useState({
    titulo: '', tipo: 'firma_arrendamiento', fecha: '',
    hora: '10:00', duracion_min: 60, lugar: '', notas: '',
    firma_id: '', asistentes: ''
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) { cargarFirmas(); cargarCitas() }
  }, [session, filtro])

  async function cargarFirmas() {
    setLoading(true)
    const { data } = await supabase.from('firmas').select('*, firma_etapas(*)').eq('status', filtro).order('created_at', { ascending: false })
    setFirmas(data || [])
    setLoading(false)
  }

  async function cargarCitas() {
    const { data } = await supabase.from('firmas_citas').select('*, firmas(titulo, tipo)').order('fecha', { ascending: true }).order('hora', { ascending: true })
    setCitas(data || [])
  }

  async function guardarCita() {
    if (!formCita.titulo || !formCita.fecha || !formCita.hora) return
    setSavingCita(true)
    const { data: { user } } = await supabase.auth.getUser()
    const asistentesArr = formCita.asistentes ? formCita.asistentes.split(',').map(a => a.trim()).filter(Boolean) : []
    await supabase.from('firmas_citas').insert({
      titulo: formCita.titulo,
      tipo: formCita.tipo,
      fecha: formCita.fecha,
      hora: formCita.hora,
      duracion_min: parseInt(formCita.duracion_min) || 60,
      lugar: formCita.lugar || null,
      notas: formCita.notas || null,
      firma_id: formCita.firma_id || null,
      asistentes: asistentesArr,
      creado_por: user?.email,
    })
    setSavingCita(false)
    setShowModalCita(false)
    setFormCita({ titulo: '', tipo: 'firma_arrendamiento', fecha: diaSeleccionado || '', hora: '10:00', duracion_min: 60, lugar: '', notas: '', firma_id: '', asistentes: '' })
    cargarCitas()
  }

  async function eliminarCita(id) {
    if (!confirm('¿Eliminar esta cita?')) return
    await supabase.from('firmas_citas').delete().eq('id', id)
    cargarCitas()
    setShowModalDetalleDia(false)
  }

  async function handleLogout() { await supabase.auth.signOut(); setSession(null) }

  async function restaurarFlujosActivos() {
    setRestaurandoFlujos(true)
    setResultadoRestauracion(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      }

      const previewRes = await fetch('/api/firmas/restaurar-flujo-activo', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dryRun: true }),
      })
      const preview = await previewRes.json()
      if (!previewRes.ok || !preview.ok) throw new Error(preview.error || 'No se pudo revisar la restauración')

      if (!preview.total_por_restaurar) {
        setResultadoRestauracion('No encontré expedientes activos con respaldo pendiente de restaurar.')
        setRestaurandoFlujos(false)
        return
      }

      const nombres = (preview.resumen || []).map(item => `• ${item.titulo}`).slice(0, 8).join('\n')
      const extra = preview.total_por_restaurar > 8 ? `\n…y ${preview.total_por_restaurar - 8} más` : ''
      const confirmar = confirm(
        `Se restaurarán ${preview.total_por_restaurar} expedientes activos al flujo completo.\n\n` +
        `${nombres}${extra}\n\n` +
        'Se usará el respaldo guardado en bitácora y se conservarán las etapas iniciales. ¿Continuar?'
      )
      if (!confirmar) {
        setRestaurandoFlujos(false)
        return
      }

      const res = await fetch('/api/firmas/restaurar-flujo-activo', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dryRun: false }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo restaurar el flujo')

      setResultadoRestauracion(`Flujos restaurados: ${data.total_restauradas}. Errores: ${data.total_errores}.`)
      await cargarFirmas()
    } catch (error) {
      setResultadoRestauracion(`No se pudo restaurar: ${error.message}`)
    } finally {
      setRestaurandoFlujos(false)
    }
  }

  const RESPONSABLE_LABELS = {
    ventas: 'Ventas',
    juridico: 'Jurídico',
    administracion: 'Administración (Tania)',
    coordinacion: 'Administración (Tania)',
    direccion: 'Dirección',
    asesor: 'Asesor',
    automatico: 'Automático',
  }

  // Calendario — construir días del mes
  const primerDia = new Date(anioActual, mesActual, 1).getDay()
  const diasEnMes = new Date(anioActual, mesActual + 1, 0).getDate()
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })

  const citasPorDia = (dia) => {
    const fecha = `${anioActual}-${String(mesActual + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
    return citas.filter(c => c.fecha === fecha)
  }

  const abrirDia = (dia) => {
    const fecha = `${anioActual}-${String(mesActual + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
    setDiaSeleccionado(fecha)
    const citasDia = citasPorDia(dia)
    if (citasDia.length > 0) {
      setCitasDelDia(citasDia)
      setShowModalDetalleDia(true)
    } else {
      setFormCita(f => ({ ...f, fecha }))
      setShowModalCita(true)
    }
  }

  // Próximas citas (los próximos 7 días)
  const proximasCitas = citas.filter(c => c.fecha >= hoy).slice(0, 5)

  if (authLoading || permisoCargando) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#888' }}>Cargando...</p></div>

  if (!session) {
    if (typeof window !== 'undefined') window.location.href = '/'
    return null
  }

  if (!puedeVer) return <SinAcceso />

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '3px solid #C8102E', padding: '0 24px', height: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 32, background: '#e5e7eb' }} />
          <div>
            <p style={{ margin: 0, fontSize: 9, color: '#C8102E', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Área Jurídica</p>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>Coordinación de Firmas</h1>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <a href="/" style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Panel</a>
          <Link href="/recibos/nuevo" style={{ background: '#C8102E', color: '#fff', padding: '0.6rem 1.25rem', borderRadius: '8px', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>
            + Crear desde recibo
          </Link>
          <button onClick={handleLogout} style={{ background: '#f3f4f6', color: '#555', border: 'none', padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>Salir</button>
        </div>
      </div>

      <div style={{ padding: '0 0.75rem' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb', paddingBottom: 0 }}>
          {[['expedientes', '📋 Expedientes'], ['calendario', '📅 Calendario']].map(([v, l]) => (
            <button key={v} onClick={() => setVista(v)} style={{
              padding: '10px 20px', border: 'none', borderBottom: `2px solid ${vista === v ? '#C8102E' : 'transparent'}`,
              background: 'transparent', color: vista === v ? '#C8102E' : '#9ca3af',
              fontSize: '0.9rem', cursor: 'pointer', fontWeight: vista === v ? 700 : 400
            }}>{l}</button>
          ))}
        </div>

        {/* ── EXPEDIENTES ── */}
        {vista === 'expedientes' && (
          <>
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
            {filtro === 'activo' && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '0.85rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: 0, color: '#9a3412', fontSize: '0.84rem', fontWeight: 800 }}>Restauración de flujo completo</p>
                  <p style={{ margin: '3px 0 0', color: '#9a3412', fontSize: '0.78rem' }}>
                    Si un expediente activo quedó con etapas faltantes, esta acción restaura el flujo usando el respaldo guardado en bitácora.
                  </p>
                  {resultadoRestauracion && <p style={{ margin: '6px 0 0', color: '#1a3c5e', fontSize: '0.78rem', fontWeight: 700 }}>{resultadoRestauracion}</p>}
                </div>
                <button onClick={restaurarFlujosActivos} disabled={restaurandoFlujos}
                  style={{ background: restaurandoFlujos ? '#9ca3af' : '#1a3c5e', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1rem', fontSize: '0.84rem', fontWeight: 800, cursor: restaurandoFlujos ? 'not-allowed' : 'pointer' }}>
                  {restaurandoFlujos ? 'Restaurando...' : 'Restaurar flujo completo'}
                </button>
              </div>
            )}
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
                const citasFirma = citas.filter(c => c.firma_id === firma.id && c.fecha >= hoy)
                return (
                  <Link key={firma.id} href={`/firmas/${firma.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ background: '#fff', borderRadius: '10px', padding: '1rem 1.25rem', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #eee', borderLeft: `4px solid ${semaforo}`, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          <p style={{ margin: '0 0 2px', fontSize: '0.75rem', color: '#888' }}>{firma.tipo} {firma.urgente ? '— URGENTE' : ''}</p>
                          <p style={{ margin: 0, fontWeight: 600, color: '#1a3c5e', fontSize: '0.95rem' }}>{firma.titulo}</p>
                          {etapaActual && <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#666' }}>Etapa actual: {etapaActual.nombre} ({RESPONSABLE_LABELS[etapaActual.responsable]})</p>}
                          {citasFirma.length > 0 && (
                            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#1a3c5e', fontWeight: 600 }}>
                              📅 {citasFirma[0].fecha} {citasFirma[0].hora?.slice(0,5)} — {TIPO_LABELS[citasFirma[0].tipo]?.emoji} {TIPO_LABELS[citasFirma[0].tipo]?.label}
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
              {!loading && firmas.length === 0 && <p style={{ color: '#aaa', textAlign: 'center', padding: '2rem' }}>No hay expedientes</p>}
            </div>
          </>
        )}

        {/* ── CALENDARIO ── */}
        {vista === 'calendario' && (
          <div>
            {/* Próximas citas */}
            {proximasCitas.length > 0 && (
              <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 18px', marginBottom: 20, border: '1px solid #bfdbfe' }}>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>📅 Próximas citas</p>
                {proximasCitas.map(c => {
                  const t = TIPO_LABELS[c.tipo] || TIPO_LABELS.otro
                  return (
                    <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #bfdbfe' }}>
                      <span style={{ fontSize: 18 }}>{t.emoji}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>{c.titulo}</p>
                        <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>{c.fecha} · {c.hora?.slice(0,5)} · {c.lugar || 'Sin lugar'}</p>
                        {c.firmas && <p style={{ margin: 0, fontSize: 11, color: '#1e40af' }}>📋 {c.firmas.titulo}</p>}
                      </div>
                      <span style={{ background: t.bg, color: t.color, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{t.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Navegación mes */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <button onClick={() => { if (mesActual === 0) { setMesActual(11); setAnioActual(a => a - 1) } else setMesActual(m => m - 1) }}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>←</button>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>{MESES[mesActual]} {anioActual}</h2>
              <button onClick={() => { if (mesActual === 11) { setMesActual(0); setAnioActual(a => a + 1) } else setMesActual(m => m + 1) }}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>→</button>
            </div>

            {/* Botón nueva cita */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button onClick={() => { setFormCita(f => ({ ...f, fecha: hoy })); setShowModalCita(true) }}
                style={{ background: '#1a3c5e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                + Nueva cita
              </button>
            </div>

            {/* Grid calendario */}
            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
              {/* Header días */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {DIAS.map(d => (
                  <div key={d} style={{ padding: '10px 4px', minWidth: 0, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>{d}</div>
                ))}
              </div>
              {/* Días */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {/* Espacios vacíos antes del día 1 */}
                {Array.from({ length: primerDia }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ minHeight: 80, minWidth: 0, borderRight: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6', background: '#fafafa' }} />
                ))}
                {/* Días del mes */}
                {Array.from({ length: diasEnMes }, (_, i) => i + 1).map(dia => {
                  const fechaDia = `${anioActual}-${String(mesActual + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
                  const esHoy = fechaDia === hoy
                  const citasDia = citasPorDia(dia)
                  return (
                    <div key={dia} onClick={() => abrirDia(dia)}
                      style={{ minHeight: 80, minWidth: 0, overflow: 'hidden', borderRight: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6', padding: '6px', cursor: 'pointer', background: esHoy ? '#eff6ff' : '#fff', transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = esHoy ? '#dbeafe' : '#f9fafb'}
                      onMouseLeave={e => e.currentTarget.style.background = esHoy ? '#eff6ff' : '#fff'}>
                      <div style={{ fontSize: 13, fontWeight: esHoy ? 800 : 400, color: esHoy ? '#1e40af' : '#374151', marginBottom: 4,
                        background: esHoy ? '#1e40af' : 'transparent', color: esHoy ? '#fff' : '#374151',
                        width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {dia}
                      </div>
                      {citasDia.map((c, i) => {
                        const t = TIPO_LABELS[c.tipo] || TIPO_LABELS.otro
                        return (
                          <div key={i} style={{ background: t.bg, color: t.color, borderRadius: 4, padding: '2px 4px', fontSize: 10, fontWeight: 600, marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                            {t.emoji} {c.hora?.slice(0,5)} {c.titulo}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal nueva cita */}
      {showModalCita && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1a3c5e' }}>📅 Nueva cita</h3>
              <button onClick={() => setShowModalCita(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Título *</label>
                <input value={formCita.titulo} onChange={e => setFormCita(f => ({ ...f, titulo: e.target.value }))}
                  placeholder="Ej: Firma contrato Casa Vista Azul"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Tipo</label>
                <select value={formCita.tipo} onChange={e => setFormCita(f => ({ ...f, tipo: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                  {Object.entries(TIPO_LABELS).map(([v, t]) => (
                    <option key={v} value={v}>{t.emoji} {t.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Fecha *</label>
                  <input type="date" value={formCita.fecha} onChange={e => setFormCita(f => ({ ...f, fecha: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Hora *</label>
                  <input type="time" value={formCita.hora} onChange={e => setFormCita(f => ({ ...f, hora: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Duración (min)</label>
                  <input type="number" value={formCita.duracion_min} onChange={e => setFormCita(f => ({ ...f, duracion_min: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Lugar</label>
                  <input value={formCita.lugar} onChange={e => setFormCita(f => ({ ...f, lugar: e.target.value }))}
                    placeholder="Notaría, oficina..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Expediente vinculado</label>
                <select value={formCita.firma_id} onChange={e => setFormCita(f => ({ ...f, firma_id: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#fff', boxSizing: 'border-box' }}>
                  <option value="">Sin vincular</option>
                  {firmas.map(f => <option key={f.id} value={f.id}>{f.titulo}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Asistentes (separados por coma)</label>
                <input value={formCita.asistentes} onChange={e => setFormCita(f => ({ ...f, asistentes: e.target.value }))}
                  placeholder="Zaye, Asesor, Cliente..."
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Notas</label>
                <textarea value={formCita.notas} onChange={e => setFormCita(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones..."
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box', minHeight: 60, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowModalCita(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
              <button onClick={guardarCita} disabled={savingCita || !formCita.titulo || !formCita.fecha || !formCita.hora}
                style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#1a3c5e', color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: !formCita.titulo || !formCita.fecha ? 0.5 : 1 }}>
                {savingCita ? 'Guardando...' : 'Guardar cita'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle día */}
      {showModalDetalleDia && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1a3c5e' }}>📅 {diaSeleccionado}</h3>
              <button onClick={() => setShowModalDetalleDia(false)} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>✕</button>
            </div>
            {citasDelDia.map(c => {
              const t = TIPO_LABELS[c.tipo] || TIPO_LABELS.otro
              return (
                <div key={c.id} style={{ background: t.bg, borderRadius: 10, padding: '12px 14px', marginBottom: 10, border: `1px solid ${t.color}33` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{t.emoji} {c.titulo}</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>{c.hora?.slice(0,5)} · {c.duracion_min} min · {c.lugar || 'Sin lugar'}</p>
                      {c.firmas && <p style={{ margin: '2px 0 0', fontSize: 12, color: t.color, fontWeight: 600 }}>📋 {c.firmas.titulo}</p>}
                      {c.asistentes?.length > 0 && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>👥 {c.asistentes.join(', ')}</p>}
                      {c.notas && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9ca3af' }}>{c.notas}</p>}
                    </div>
                    <button onClick={() => eliminarCita(c.id)} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                      Eliminar
                    </button>
                  </div>
                </div>
              )
            })}
            <button onClick={() => { setShowModalDetalleDia(false); setFormCita(f => ({ ...f, fecha: diaSeleccionado })); setShowModalCita(true) }}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px dashed #1a3c5e', background: '#eff6ff', color: '#1a3c5e', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              + Agregar otra cita este día
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
