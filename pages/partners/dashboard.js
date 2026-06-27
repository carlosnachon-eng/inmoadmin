import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import PartnerLayout, { P, PartnerBadge, button } from '../../components/partners/PartnerLayout'
import { fmtMoney, getPartnerContext, loadPartnerOperations, PARTNER_STATUS } from '../../lib/partners'

export default function PartnerDashboard() {
  const [ctx, setCtx] = useState(null)
  const [operations, setOperations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const nextCtx = await getPartnerContext()
        if (!nextCtx.agency) {
          window.location.href = '/partners/login'
          return
        }
        setCtx(nextCtx)
        setOperations(await loadPartnerOperations(nextCtx.agency.id))
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const stats = useMemo(() => {
    const abiertas = operations.filter(o => !['activa', 'rechazada', 'cancelada'].includes(o.status_partner)).length
    return {
      total: operations.length,
      abiertas,
      activas: operations.filter(o => o.status_partner === 'activa').length,
      comisionGenerada: operations.reduce((sum, o) => sum + (Number(o.commission_generated) || 0), 0),
      comisionPagada: operations.reduce((sum, o) => sum + (Number(o.commission_paid) || 0), 0),
    }
  }, [operations])

  if (loading || !ctx) return null

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Operaciones | Portal Partner</title></Head>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <p style={{ margin: '0 0 4px', color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Operaciones</p>
          <h1 style={{ margin: 0, color: P.ink, fontSize: 28 }}>Seguimiento juridico</h1>
          <p style={{ margin: '6px 0 0', color: P.muted, fontSize: 14 }}>Aqui ves solo las operaciones enviadas por tu inmobiliaria.</p>
        </div>
        <a href="/partners/nueva-operacion" style={{ ...button, background: P.red, color: '#fff' }}>Nueva operacion</a>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: 12, marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          ['Total', stats.total],
          ['En proceso', stats.abiertas],
          ['Activas', stats.activas],
          ['Comision generada', fmtMoney(stats.comisionGenerada)],
          ['Comision pagada', fmtMoney(stats.comisionPagada)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 9, padding: 16 }}>
            <p style={{ margin: '0 0 6px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{label}</p>
            <p style={{ margin: 0, color: P.ink, fontSize: 22, fontWeight: 900 }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, overflow: 'hidden' }}>
        {operations.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center' }}>
            <p style={{ margin: '0 0 8px', color: P.ink, fontSize: 18, fontWeight: 850 }}>Aun no hay operaciones</p>
            <p style={{ margin: '0 0 18px', color: P.muted, fontSize: 14 }}>Crea la primera para que Emporio inicie el proceso juridico.</p>
            <a href="/partners/nueva-operacion" style={{ ...button, background: P.red, color: '#fff' }}>Crear primera operacion</a>
          </div>
        ) : (
          operations.map((op, index) => (
            <a key={op.id} href={`/partners/operaciones/${op.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 150px 150px 150px', gap: 12, alignItems: 'center', padding: '15px 16px', borderTop: index ? `1px solid ${P.line}` : 'none', color: 'inherit', textDecoration: 'none' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, color: P.ink, fontSize: 14, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.nombre_inquilino || 'Inquilino pendiente'}</p>
                <p style={{ margin: '3px 0 0', color: P.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.direccion_inmueble || 'Sin direccion'} · {op.folio || op.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <PartnerBadge status={op.status_partner} statuses={PARTNER_STATUS} />
              <span style={{ color: P.text, fontSize: 13, fontWeight: 750 }}>{fmtMoney(op.monto_poliza_final || op.monto_poliza_estimado)}</span>
              <span style={{ color: P.green, fontSize: 13, fontWeight: 850 }}>{fmtMoney(op.commission_generated || op.commission_estimated)}</span>
            </a>
          ))
        )}
      </div>

      <style jsx global>{`
        @media (max-width: 900px) {
          div[style*="repeat(5"] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          a[style*="grid-template-columns: minmax(220px"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </PartnerLayout>
  )
}
