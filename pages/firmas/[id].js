import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'

const RESPONSABLE_LABELS = {
  ventas: 'Ventas',
  juridico: 'Juridico',
  administracion: 'Administracion (Tania)',
  coordinacion: 'Administracion (Tania)',
  direccion: 'Direccion',
}

const STATUS_COLORS = {
  pendiente:  { bg: '#f5f5f5', color: '#888',    label: 'Pendiente' },
  en_proceso: { bg: '#fff8e1', color: '#f59e0b', label: 'En proceso' },
  completada: { bg: '#e8f5e9', color: '#22c55e', label: 'Completada' },
  no_aplica:  { bg: '#f5f5f5', color: '#bbb',    label: 'No aplica' },
  bloqueada:  { bg: '#fdecea', color: '#ef4444', label: 'Bloqueada' },
}

export default function DetalleFirma() {
  const router = useRouter()
  const { id } = router.query

  const [firma, setFirma] = useState(null)
  const [etapas, setEtapas] = useState([])
  const [comentarios, setComentarios] = useState([])
  const [comentario, setComentario] = useState('')
  const [notaEtapa, setNotaEtapa] = useState('')
  const [etapaActiva, setEtapaActiva] = useState(null)
  const [loading, setLoading] = useState(true)
  const [avanzando, setAvanzando] = useState(false)
  const [editandoDatos, setEditandoDatos] = useState(false)
  const [guardandoDatos, setGuardandoDatos] = useState(false)
  const [datosForm, setDatosForm] = useState({ nombre_comprador: '', nombre_vendedor: '' })

  useEffect(() => { if (!id) return; cargarTodo() }, [id])

  async function cargarTodo() {
    const [{ data: f }, { data: e }, { data: c }] = await Promise.all([
      supabase.from('firmas').select('*').eq('id', id).single(),
      supabase.from('firma_etapas').select('*').eq('firma_id', id).order('orden'),
      supabase.from('firma_comentarios').select('*').eq('firma_id', id).order('created_at', { ascending: false })
    ])
    setFirma(f)
    setDatosForm({
      nombre_comprador: f?.nombre_comprador || '',
      nombre_vendedor: f?.nombre_vendedor || '',
    })
    setEtapas(e || [])
    setComentarios(c || [])
    setLoading(false)
  }

  async function completarEtapa(etapa) {
    setAvanzando(true)
    const { data: { user } } = await supabase.auth.getUser()
    await fetch('/api/firmas/avanzar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firma_id: id,
        etapa_id: etapa.id,
        notas: notaEtapa,
        usuario_id: user?.id,
        usuario_nombre: user?.email,
      })
    })
    setNotaEtapa('')
    setEtapaActiva(null)
    setAvanzando(false)
    cargarTodo()
  }

  async function enviarComentario() {
    if (!comentario.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('firma_comentarios').insert({
      firma_id: id,
      usuario_id: user?.id,
      usuario_nombre: user?.email,
      mensaje: comentario,
      tipo: 'comentario'
    })
    setComentario('')
    cargarTodo()
  }

  async function guardarDatosGenerales() {
    setGuardandoDatos(true)
    const { data: { user } } = await supabase.auth.getUser()
    const cambios = {
      nombre_comprador: datosForm.nombre_comprador.trim(),
      nombre_vendedor: datosForm.nombre_vendedor.trim(),
    }
    const { error } = await supabase.from('firmas').update(cambios).eq('id', id)
    if (!error) {
      await supabase.from('firma_comentarios').insert({
        firma_id: id,
        usuario_id: user?.id,
        usuario_nombre: user?.email,
        mensaje: 'Datos de comprador/inquilino y propietario actualizados.',
        tipo: 'comentario'
      })
      setEditandoDatos(false)
      await cargarTodo()
    } else {
      alert(`No se pudieron guardar los datos: ${error.message}`)
    }
    setGuardandoDatos(false)
  }

  if (loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Cargando expediente...</div>
  if (!firma) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Expediente no encontrado</div>

  const progreso = etapas.filter(e => e.status === 'completada').length
  const total = etapas.filter(e => e.status !== 'no_aplica').length
  const pct = total > 0 ? Math.round((progreso / total) * 100) : 0
  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '3px solid #C8102E', padding: '0 24px', height: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 32, background: '#e5e7eb' }} />
          <div>
            <p style={{ margin: 0, fontSize: 9, color: '#C8102E', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Área Jurídica</p>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1a1a2e' }}>Coordinación de Firmas</h1>
          </div>
        </div>
        <Link href="/firmas" style={{ fontSize: '0.85rem', color: '#9ca3af', textDecoration: 'none', fontWeight: 600 }}>← Volver</Link>
      </div>

      <div style={{ padding: '0 0.75rem' }}>

        {/* Info del expediente */}
        <div style={{ background: '#1a3c5e', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <p style={{ color: '#c8a45a', fontSize: '0.8rem', margin: '0 0 4px' }}>
                {firma.tipo?.toUpperCase()} {firma.es_contado ? '(Contado)' : ''}
              </p>
              <h1 style={{ color: '#fff', fontSize: '1.15rem', margin: 0 }}>{firma.titulo}</h1>
              {firma.direccion && <p style={{ color: '#aac4de', fontSize: '0.85rem', margin: '4px 0 0' }}>{firma.direccion}</p>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button onClick={() => setEditandoDatos(v => !v)}
                style={{ background: '#fff', color: '#1a3c5e', border: 'none', borderRadius: '20px', padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                {editandoDatos ? 'Cerrar edición' : 'Editar datos'}
              </button>
              <span style={{
                background: firma.status === 'completado' ? '#22c55e' : firma.status === 'cancelado' ? '#ef4444' : firma.urgente ? '#f59e0b' : '#c8a45a',
                color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600
              }}>
                {firma.status === 'completado' ? 'Completado' : firma.status === 'cancelado' ? 'Cancelado' : firma.urgente ? 'Urgente' : 'En proceso'}
              </span>
              {firma.status === 'activo' && (
                <button onClick={async () => {
                  if (!confirm('Cancelar este expediente?')) return
                  const { data: { user } } = await supabase.auth.getUser()
                  await supabase.from('firmas').update({ status: 'cancelado' }).eq('id', id)
                  if (firma.recibo_id) {
                    await supabase.from('recibos_apartado').update({ estatus: 'cancelado' }).eq('id', firma.recibo_id)
                    await supabase.from('recibos_log').insert({
                      recibo_id: firma.recibo_id,
                      accion: 'cancelado_desde_firmas',
                      usuario_id: user?.id || null,
                      notas: 'Expediente de Firmas cancelado',
                    })
                  }
                  cargarTodo()
                }} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '20px', padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                  Cancelar
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#aac4de', fontSize: '0.8rem' }}>Progreso</span>
              <span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>{pct}% ({progreso}/{total} etapas)</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: '4px', height: '8px' }}>
              <div style={{ background: '#c8a45a', width: `${pct}%`, height: '8px', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            {[
              ['Comprador/Inquilino', firma.nombre_comprador],
              ['Propietario', firma.nombre_vendedor],
              ['Forma de pago', firma.forma_pago],
              ['Modalidad', firma.modalidad_firma],
            ].map(([k, v]) => v && (
              <div key={k}>
                <p style={{ color: '#aac4de', fontSize: '0.72rem', margin: '0 0 2px' }}>{k}</p>
                <p style={{ color: '#fff', fontSize: '0.85rem', margin: 0, textTransform: 'capitalize' }}>{v}</p>
              </div>
            ))}
          </div>
          {editandoDatos && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', color: '#aac4de', fontSize: '0.75rem', marginBottom: 4 }}>Comprador / Inquilino</label>
                  <input value={datosForm.nombre_comprador}
                    onChange={e => setDatosForm(f => ({ ...f, nombre_comprador: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.88rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', color: '#aac4de', fontSize: '0.75rem', marginBottom: 4 }}>Nombre del propietario</label>
                  <input value={datosForm.nombre_vendedor}
                    onChange={e => setDatosForm(f => ({ ...f, nombre_vendedor: e.target.value }))}
                    placeholder="Escribe el nombre del dueño"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.88rem' }} />
                </div>
              </div>
              <button onClick={guardarDatosGenerales} disabled={guardandoDatos}
                style={{ marginTop: '0.75rem', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: '0.85rem', fontWeight: 700, cursor: guardandoDatos ? 'not-allowed' : 'pointer' }}>
                {guardandoDatos ? 'Guardando...' : 'Guardar datos'}
              </button>
            </div>
          )}
        </div>


        <div style={{ display: 'grid', gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth < 768 ? '1fr' : '1fr 320px', gap: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1rem', color: '#1a3c5e', marginBottom: '1rem' }}>Etapas del proceso</h2>
            {etapas.map((etapa, i) => {
              const sc = STATUS_COLORS[etapa.status] || STATUS_COLORS.pendiente
              const esActual = etapa.status === 'pendiente' && (i === 0 || etapas[i-1]?.status === 'completada' || etapas[i-1]?.status === 'no_aplica')
              const abierta = etapaActiva === etapa.id
              return (
                <div key={etapa.id} style={{
                  background: '#fff', borderRadius: '8px', marginBottom: '8px',
                  border: esActual ? '2px solid #1a3c5e' : '1px solid #eee',
                  opacity: etapa.status === 'no_aplica' ? 0.5 : 1
                }}>
                  <div style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                      background: etapa.status === 'completada' ? '#22c55e' : esActual ? '#1a3c5e' : '#eee',
                      color: etapa.status === 'completada' || esActual ? '#fff' : '#999',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.8rem', fontWeight: 700
                    }}>
                      {etapa.status === 'completada' ? 'OK' : etapa.orden}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: esActual ? 600 : 400, color: etapa.status === 'no_aplica' ? '#bbb' : '#222' }}>
                        {etapa.nombre}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#888' }}>
                        {RESPONSABLE_LABELS[etapa.responsable]}
                        {etapa.completada_at && ` — ${new Date(etapa.completada_at).toLocaleDateString('es-MX')}`}
                      </p>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 600, background: sc.bg, color: sc.color }}>
                      {sc.label}
                    </span>
                    {esActual && (
                      <button onClick={() => setEtapaActiva(abierta ? null : etapa.id)}
                        style={{ background: '#1a3c5e', color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer' }}>
                        {abierta ? 'Cerrar' : 'Completar'}
                      </button>
                    )}
                  </div>
                  {abierta && (
                    <div style={{ borderTop: '1px solid #eee', padding: '0.9rem 1rem', background: '#fafafa', borderRadius: '0 0 8px 8px' }}>
                      <label style={{ fontSize: '0.82rem', color: '#555', display: 'block', marginBottom: '6px' }}>Notas (opcional)</label>
                      <textarea value={notaEtapa} onChange={e => setNotaEtapa(e.target.value)} rows={2}
                        placeholder="Agrega observaciones si es necesario..."
                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box', resize: 'none' }} />
                      <button onClick={() => completarEtapa(etapa)} disabled={avanzando}
                        style={{ marginTop: '8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 20px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
                        {avanzando ? 'Guardando...' : 'Marcar como completada y notificar'}
                      </button>
                    </div>
                  )}
                  {etapa.notas && etapa.status === 'completada' && (
                    <div style={{ borderTop: '1px solid #eee', padding: '0.6rem 1rem', fontSize: '0.8rem', color: '#666', background: '#fafafa', borderRadius: '0 0 8px 8px' }}>
                      Nota: {etapa.notas}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div>
            <h2 style={{ fontSize: '1rem', color: '#1a3c5e', marginBottom: '1rem' }}>Bitacora</h2>
            <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #eee', padding: '1rem', marginBottom: '1rem' }}>
              <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3}
                placeholder="Escribe un comentario..."
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box', resize: 'none' }} />
              <button onClick={enviarComentario}
                style={{ marginTop: '8px', background: '#1a3c5e', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '0.85rem', cursor: 'pointer', width: '100%' }}>
                Agregar comentario
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {comentarios.map(c => (
                <div key={c.id} style={{ background: c.tipo === 'cambio_etapa' ? '#f0f7ff' : '#fff', border: '1px solid #eee', borderRadius: '8px', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1a3c5e' }}>{c.usuario_nombre || 'Sistema'}</span>
                    <span style={{ fontSize: '0.72rem', color: '#aaa' }}>{new Date(c.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#444' }}>{c.mensaje}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
