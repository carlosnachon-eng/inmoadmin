import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'

const RESPONSABLE_LABELS = {
  ventas: 'Ventas',
  juridico: 'Juridico',
  administracion: 'Administracion',
  coordinacion: 'Coordinacion (Majo)',
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
  const supabase = createClientComponentClient()

  const [firma, setFirma] = useState(null)
  const [etapas, setEtapas] = useState([])
  const [comentarios, setComentarios] = useState([])
  const [comentario, setComentario] = useState('')
  const [notaEtapa, setNotaEtapa] = useState('')
  const [etapaActiva, setEtapaActiva] = useState(null)
  const [loading, setLoading] = useState(true)
  const [avanzando, setAvanzando] = useState(false)

  useEffect(() => { if (!id) return; cargarTodo() }, [id])

  async function cargarTodo() {
    const [{ data: f }, { data: e }, { data: c }] = await Promise.all([
      supabase.from('firmas').select('*').eq('id', id).single(),
      supabase.from('firma_etapas').select('*').eq('firma_id', id).order('orden'),
      supabase.from('firma_comentarios').select('*').eq('firma_id', id).order('created_at', { ascending: false })
    ])
    setFirma(f)
    setEtapas(e || [])
    setComentarios(c || [])
    setLoading(false)
  }

  async function completarEtapa(etapa) {
    setAvanzando(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).single()
    await fetch('/api/firmas/avanzar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firma_id: id, etapa_id: etapa.id, notas: notaEtapa,
        usuario_id: user.id, usuario_nombre: perfil?.nombre || user.email,
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
    const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).single()
    await supabase.from('firma_comentarios').insert({
      firma_id: id, usuario_id: user.id,
      usuario_nombre: perfil?.nombre || user.email,
      mensaje: comentario, tipo: 'comentario'
    })
    setComentario('')
    cargarTodo()
  }

  if (loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Cargando expediente...</div>
  if (!firma) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Expediente no encontrado</div>

  const progreso = etapas.filter(e => e.status === 'completada').length
  const total = etapas.filter(e => e.status !== 'no_aplica').length
  const pct = total > 0 ? Math.round((progreso / total) * 100) : 0

  return (
    <div style={{ maxWidth: '780px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/firmas" style={{ fontSize: '0.85rem', color: '#888', textDecoration: 'none' }}>← Volver a firmas</Link>
      </div>

      <div style={{ background: '#1a3c5e', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <p style={{ color: '#c8a45a', fontSize: '0.8rem', margin: '0 0 4px' }}>
              {firma.tipo?.toUpperCase()} {firma.es_contado ? '(Contado)' : ''}
            </p>
            <h1 style={{ color: '#fff', fontSize: '1.15rem', margin: 0 }}>{firma.titulo}</h1>
            {firma.direccion && <p style={{ color: '#aac4de', fontSize: '0.85rem', margin: '4px 0 0' }}>{firma.direccion}</p>}
          </div>
          <span style={{
            background: firma.status === 'completado' ? '#22c55e' : firma.urgente ? '#ef4444' : '#c8a45a',
            color: '#fff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600
          }}>
            {firma.status === 'completado' ? 'Completado' : firma.urgente ? 'Urgente' : 'En proceso'}
          </span>
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
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>
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
  )
}
