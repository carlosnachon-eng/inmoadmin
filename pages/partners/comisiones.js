import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import PartnerLayout, { P, PartnerBadge } from '../../components/partners/PartnerLayout'
import { fmtMoney, getPartnerContext, loadPartnerOperations, PARTNER_STATUS } from '../../lib/partners'

export default function PartnerComisiones() {
  const [ctx, setCtx] = useState(null)
  const [operations, setOperations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const nextCtx = await getPartnerContext()
      if (!nextCtx.agency) {
        window.location.href = '/partners/login'
        return
      }
      if (nextCtx.agency.status !== 'activo') {
        window.location.href = '/partners/pendiente'
        return
      }
      setCtx(nextCtx)
      setOperations(await loadPartnerOperations(nextCtx.agency.id))
      setLoading(false)
    }
    load()
  }, [])

  const totals = useMemo(() => ({
    estimated: operations.reduce((s, o) => s + (Number(o.commission_estimated) || 0), 0),
    generated: operations.reduce((s, o) => s + (Number(o.commission_generated) || 0), 0),
    paid: operations.reduce((s, o) => s + (Number(o.commission_paid) || 0), 0),
  }), [operations])

  if (loading || !ctx) return null

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Comisiones | Portal Partner</title></Head>
      <p style={{ margin: '0 0 4px', color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Comisiones</p>
      <h1 style={{ margin: '0 0 8px', color: P.ink, fontSize: 28 }}>Comisiones de aliado</h1>
      <p style={{ margin: '0 0 18px', color: P.muted, fontSize: 14 }}>La comision se genera solo cuando la poliza esta cobrada y activa.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['Estimadas', totals.estimated, '#fafafa', P.ink],
          ['Generadas', totals.generated, '#ecfdf5', '#065f46'],
          ['Pagadas', totals.paid, '#ecfdf5', '#065f46'],
        ].map(([label, value, bg, color]) => (
          <div key={label} style={{ background: bg, border: `1px solid ${P.line}`, borderRadius: 10, padding: 18 }}>
            <p style={{ margin: '0 0 6px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{label}</p>
            <p style={{ margin: 0, color, fontSize: 28, fontWeight: 950 }}>{fmtMoney(value)}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, overflow: 'hidden' }}>
        {operations.length === 0 ? (
          <p style={{ margin: 0, padding: 28, color: P.muted, textAlign: 'center' }}>Aun no hay operaciones con comision.</p>
        ) : operations.map((op, index) => (
          <a key={op.id} href={`/partners/operaciones/${op.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 140px 140px 140px 130px', gap: 12, alignItems: 'center', padding: '14px 16px', borderTop: index ? `1px solid ${P.line}` : 'none', color: 'inherit', textDecoration: 'none' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, color: P.ink, fontSize: 14, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.nombre_inquilino || 'Operacion'}</p>
              <p style={{ margin: '3px 0 0', color: P.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.direccion_inmueble || '-'}</p>
            </div>
            <PartnerBadge status={op.status_partner} statuses={PARTNER_STATUS} />
            <span style={{ color: P.text, fontSize: 13, fontWeight: 800 }}>{fmtMoney(op.commission_estimated)}</span>
            <span style={{ color: '#065f46', fontSize: 13, fontWeight: 900 }}>{fmtMoney(op.commission_generated)}</span>
            <span style={{ color: '#065f46', fontSize: 13, fontWeight: 900 }}>{fmtMoney(op.commission_paid)}</span>
          </a>
        ))}
      </div>
      <style jsx global>{`
        @media (max-width: 900px) {
          div[style*="repeat(3"] { grid-template-columns: 1fr !important; }
          a[style*="grid-template-columns: minmax(220px"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </PartnerLayout>
  )
}
