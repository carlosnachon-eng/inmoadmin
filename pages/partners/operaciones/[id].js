import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import PartnerLayout, { P, PartnerBadge, button } from '../../../components/partners/PartnerLayout'
import { fmtMoney, getPartnerContext, PARTNER_STATUS } from '../../../lib/partners'
import { supabase } from '../../../lib/supabase'

export default function PartnerOperacionDetalle() {
  const router = useRouter()
  const { id } = router.query
  const [ctx, setCtx] = useState(null)
  const [operation, setOperation] = useState(null)
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const nextCtx = await getPartnerContext()
        if (!nextCtx.agency) {
          window.location.href = '/partners/login'
          return
        }
        setCtx(nextCtx)
        const { data: op, error: opError } = await supabase
          .from('partner_operations')
          .select('*')
          .eq('id', id)
          .eq('partner_agency_id', nextCtx.agency.id)
          .maybeSingle()
        if (opError) throw opError
        if (!op) throw new Error('Operacion no encontrada')
        setOperation(op)

        const { data: docs, error: docsError } = await supabase
          .from('partner_documents')
          .select('id, party, document_type, original_name, storage_path, status, is_final, visible_to_partner, created_at')
          .eq('partner_operation_id', id)
          .eq('partner_agency_id', nextCtx.agency.id)
          .order('created_at', { ascending: false })
        if (docsError) throw docsError
        setDocuments(docs || [])
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const openDoc = async (doc) => {
    const { data, error: urlError } = await supabase.storage.from('poliza-docs').createSignedUrl(doc.storage_path, 60)
    if (urlError) {
      alert(urlError.message)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  if (loading || !ctx) return null
  if (error) return (
    <PartnerLayout agency={ctx?.agency}>
      <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 24 }}>{error}</div>
    </PartnerLayout>
  )

  const finalDocs = documents.filter(d => d.is_final || d.visible_to_partner)
  const uploadedDocs = documents.filter(d => !d.is_final && !d.visible_to_partner)

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Operacion | Portal Partner</title></Head>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <a href="/partners/dashboard" style={{ color: P.red, fontSize: 12, fontWeight: 850, textDecoration: 'none' }}>← Operaciones</a>
          <h1 style={{ margin: '8px 0 6px', color: P.ink, fontSize: 28 }}>{operation.nombre_inquilino || 'Operacion'}</h1>
          <p style={{ margin: 0, color: P.muted, fontSize: 14 }}>{operation.direccion_inmueble || 'Sin direccion'} · {operation.folio || operation.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <PartnerBadge status={operation.status_partner} statuses={PARTNER_STATUS} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr .75fr', gap: 16 }}>
        <section style={{ display: 'grid', gap: 16 }}>
          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Seguimiento</h2>
            <div style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 14 }}>
              <p style={{ margin: 0, color: P.text, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                {operation.observaciones_publicas || 'Emporio recibio la operacion. Cuando haya novedades apareceran aqui.'}
              </p>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Documentos subidos</h2>
            {uploadedDocs.length === 0 ? (
              <p style={{ margin: 0, color: P.muted, fontSize: 14 }}>No hay documentos registrados.</p>
            ) : uploadedDocs.map(doc => (
              <button key={doc.id} onClick={() => openDoc(doc)} style={{ width: '100%', textAlign: 'left', background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 12, marginBottom: 8, cursor: 'pointer' }}>
                <p style={{ margin: 0, color: P.text, fontSize: 13, fontWeight: 850 }}>{doc.original_name || doc.document_type}</p>
                <p style={{ margin: '3px 0 0', color: P.muted, fontSize: 11 }}>{doc.party} · {doc.status}</p>
              </button>
            ))}
          </div>

          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Documentos finales</h2>
            {finalDocs.length === 0 ? (
              <p style={{ margin: 0, color: P.muted, fontSize: 14 }}>Aun no hay documentos finales disponibles.</p>
            ) : finalDocs.map(doc => (
              <button key={doc.id} onClick={() => openDoc(doc)} style={{ ...button, width: '100%', justifyContent: 'space-between', background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', marginBottom: 8 }}>
                {doc.original_name || doc.document_type}
                <span>Descargar</span>
              </button>
            ))}
          </div>
        </section>

        <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Operacion</h2>
            {[
              ['Propietario', operation.nombre_propietario],
              ['Inquilino', operation.nombre_inquilino],
              ['Renta', fmtMoney(operation.monto_renta)],
              ['Poliza estimada', fmtMoney(operation.monto_poliza_estimado)],
              ['Poliza final', fmtMoney(operation.monto_poliza_final)],
            ].map(([label, value]) => (
              <div key={label} style={{ borderTop: `1px solid ${P.line}`, padding: '10px 0' }}>
                <p style={{ margin: '0 0 2px', color: P.muted, fontSize: 11, fontWeight: 850, textTransform: 'uppercase' }}>{label}</p>
                <p style={{ margin: 0, color: P.text, fontSize: 14, fontWeight: 750 }}>{value || '-'}</p>
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Comision</h2>
            <div style={{ display: 'grid', gap: 9 }}>
              <Commission label="Estimada" value={operation.commission_estimated} />
              <Commission label="Generada" value={operation.commission_generated} green />
              <Commission label="Pagada" value={operation.commission_paid} green />
            </div>
            <p style={{ margin: '12px 0 0', color: P.muted, fontSize: 11, lineHeight: 1.45 }}>
              La comision se genera solo cuando la poliza esta cobrada y activa.
            </p>
          </div>
        </aside>
      </div>

      <style jsx global>{`
        @media (max-width: 900px) {
          div[style*="grid-template-columns: 1.25fr"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </PartnerLayout>
  )
}

function Commission({ label, value, green }) {
  return (
    <div style={{ background: green ? '#ecfdf5' : '#fafafa', border: `1px solid ${green ? '#a7f3d0' : P.line}`, borderRadius: 9, padding: 12 }}>
      <p style={{ margin: '0 0 4px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: 0, color: green ? '#065f46' : P.ink, fontSize: 20, fontWeight: 950 }}>{fmtMoney(value)}</p>
    </div>
  )
}
