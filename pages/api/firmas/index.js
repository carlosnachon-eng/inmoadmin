import { useEffect, useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import { STATUS_COLORS, RESPONSABLE_LABELS } from '../../lib/firmasEtapas'

export default function FirmasDashboard() {
  const supabase = createClientComponentClient()
  const [firmas, setFirmas] = useState([])
  const [filtro, setFiltro] = useState('activo')
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarFirmas() }, [filtro])

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

  return (
    <div style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.3rem', color: '#1a3c5e', margin: 0 }}>Coordinacion de Firmas</h1>
        <Link href="/firmas/nueva"
          style={{ background: '#1a3c5e', color: '#fff', padding: '0.6rem 1.25rem',
            borderRadius: '8px', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>
          + Nuevo expediente
        </Link>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[['activo', 'En proceso'], ['completado', 'Completados'], ['cancelado', 'Cancelados']].map(([v, l]) => (
          <button key={v} onClick={() => setFiltro(v)}
            style={{
              padding: '0.4rem 1rem', borderRadius: '20px', border: '2px solid',
              borderColor: filtro === v ? '#1a3c5e' : '#ddd',
              background: filtro === v ? '#1a3c5e' : '#fff',
              color: filtro === v ? '#fff' : '#555',
              fontSize: '0.85rem', cursor: 'pointer', fontWeight: filtro === v ? 600 : 400
            }}>
            {l}
          </button>
        ))}
      </div>

      {loading && <p>Cargando...</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {firmas.map(firma => {
          const etapas = firma.firma_etapas || []
          const completadas = etapas.filter(e => e.status === 'completada').length
          const total = etapas.filter(e => e.status !== 'no_aplica').length
          const pct = total > 0 ? Math.round((completadas / total) * 100) : 0
          const etapaActual = etapas.find(e => e.status === 'pendiente' || e.status === 'en_proceso')

          // Semáforo: si lleva >24h sin moverse en etapa actual
          const horasSinMover = etapaActual
            ? (Date.now() - new Date(firma.updated_at)) / (1000 * 60 * 60)
            : 0
          const semaforo = firma.status === 'completado' ? '#22c55e'
            : horasSinMover > 24 ? '#ef4444'
            : horasSinMover > 12 ? '#f59e0b'
            : '#22c55e'

          return (
            <Link key={firma.id} href={`/firmas/${firma.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', borderRadius: '10px', padding: '1rem 1.25rem',
                boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #eee',
                borderLeft: `4px solid ${semaforo}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '0.75rem', color: '#888' }}>
                      {firma.folio} — {firma.tipo} {firma.urgente ? '⚡ URGENTE' : ''}
                    </p>
                    <p style={{ margin: 0, fontWeight: 600, color: '#1a3c5e', fontSize: '0.95rem' }}>
                      {firma.titulo}
                    </p>
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
                {/* Barra de progreso mini */}
                <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '5px', marginTop: '0.75rem' }}>
                  <div style={{ background: semaforo, width: `${pct}%`, height: '5px', borderRadius: '4px', transition: 'width 0.3s' }} />
                </div>
              </div>
            </Link>
          )
        })}
        {!loading && firmas.length === 0 && (
          <p style={{ color: '#aaa', textAlign: 'center', padding: '2rem' }}>
            No hay expedientes {filtro === 'activo' ? 'activos' : filtro === 'completado' ? 'completados' : 'cancelados'}
          </p>
        )}
      </div>
    </div>
  )
}
