import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import PartnerLayout, { P, PartnerBadge, button } from '../../../components/partners/PartnerLayout'
import { fmtMoney, getPartnerContext, PARTNER_STATUS, partnerOperationLinks } from '../../../lib/partners'
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
          .select('*, poliza_expedientes:poliza_expediente_id(id, status, fecha_firma, fecha_vigencia, fecha_inicio)')
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
  const links = partnerOperationLinks(operation, ctx.agency)
  const expediente = operation.poliza_expedientes

  const copy = async (value) => {
    await navigator.clipboard.writeText(value)
    alert('Liga copiada')
  }

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
            <h2 style={{ margin: '0 0 8px', color: P.ink, fontSize: 18 }}>Ligas personalizadas</h2>
            <p style={{ margin: '0 0 14px', color: P.muted, fontSize: 13, lineHeight: 1.5 }}>
              Envia estas ligas. Cada formulario mostrara la marca de tu inmobiliaria en alianza con Emporio Blindaje Legal.
            </p>
            <LinkBox label="Solicitud para inquilino" value={links.inquilino} onCopy={() => copy(links.inquilino)} />
            <LinkBox label="Registro para propietario" value={links.propietario} onCopy={() => copy(links.propietario)} />
          </div>

          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Seguimiento</h2>
            <div style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 14 }}>
              <p style={{ margin: 0, color: P.text, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                {operation.observaciones_publicas || 'Emporio recibio la operacion. Cuando haya novedades apareceran aqui.'}
              </p>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
            <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 18 }}>Fechas clave</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <DateCard label="Firma" value={expediente?.fecha_firma} empty="Por definir" />
              <DateCard label="Inicio" value={expediente?.fecha_inicio} empty="Por definir" />
              <DateCard label="Vigencia / renovacion" value={expediente?.fecha_vigencia} empty="Pendiente" />
            </div>
            <p style={{ margin: '12px 0 0', color: P.muted, fontSize: 12, lineHeight: 1.45 }}>
              Cuando la poliza este activa, esta fecha ayuda a anticipar renovaciones y futuras comisiones.
            </p>
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
              ['Solicitud inquilino', operation.solicitud_inquilino_id ? 'Recibida' : 'Pendiente'],
              ['Registro propietario', operation.propietario_id ? 'Recibido' : 'Pendiente'],
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

function DateCard({ label, value, empty }) {
  return (
    <div style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 12 }}>
      <p style={{ margin: '0 0 4px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: 0, color: value ? P.ink : P.muted, fontSize: 14, fontWeight: 850 }}>{value || empty}</p>
    </div>
  )
}

function LinkBox({ label, value, onCopy }) {
  return (
    <div style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 12, marginBottom: 10 }}>
      <p style={{ margin: '0 0 7px', color: P.text, fontSize: 13, fontWeight: 850 }}>{label}</p>
      <p style={{ margin: '0 0 10px', color: P.muted, fontSize: 12, overflowWrap: 'anywhere' }}>{value}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onCopy} style={{ ...button, background: P.red, color: '#fff', padding: '8px 11px', fontSize: 12 }}>Copiar liga</button>
        <a href={value} target="_blank" rel="noreferrer" style={{ ...button, background: '#f4f4f5', color: P.text, padding: '8px 11px', fontSize: 12 }}>Abrir</a>
      </div>
    </div>
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
