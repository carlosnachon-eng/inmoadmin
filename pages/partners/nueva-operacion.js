import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import PartnerLayout, { Field, P, button, input } from '../../components/partners/PartnerLayout'
import { calcCommission, COMMISSION_RATE, getPartnerContext } from '../../lib/partners'
import { supabase } from '../../lib/supabase'

const textArea = { ...input, minHeight: 86, resize: 'vertical', fontFamily: 'inherit' }

export default function NuevaOperacionPartner() {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState({})
  const formRef = useRef(null)

  useEffect(() => {
    async function load() {
      const nextCtx = await getPartnerContext()
      if (!nextCtx.agency) {
        window.location.href = '/partners/login'
        return
      }
      setCtx(nextCtx)
      setLoading(false)
    }
    load()
  }, [])

  const values = () => {
    const data = {}
    formRef.current?.querySelectorAll('[name]').forEach(el => { data[el.name] = el.value })
    return data
  }

  const upload = async (operationId, key, file) => {
    if (!file) return null
    const ext = file.name.split('.').pop()
    const path = `partners/${ctx.agency.id}/${operationId}/${key}.${ext}`
    const { error: uploadError } = await supabase.storage.from('poliza-docs').upload(path, file, { upsert: true })
    if (uploadError) throw uploadError
    await supabase.from('partner_documents').insert({
      partner_operation_id: operationId,
      partner_agency_id: ctx.agency.id,
      party: key.startsWith('propietario') ? 'propietario' : key.startsWith('inquilino') ? 'inquilino' : 'inmueble',
      document_type: key,
      storage_path: path,
      original_name: file.name,
      status: 'recibido',
      uploaded_by: ctx.user.id,
    })
    return path
  }

  const handleSubmit = async () => {
    const v = values()
    if (!v.nombre_propietario || !v.nombre_inquilino || !v.direccion_inmueble) {
      setError('Completa propietario, inquilino y direccion del inmueble.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const montoRenta = Number(v.monto_renta) || null
      const montoPoliza = Number(v.monto_poliza_estimado) || null
      const commissionRate = Number(ctx.agency.commission_rate || COMMISSION_RATE)

      const { data: propietario, error: propError } = await supabase
        .from('propietarios_inmuebles')
        .insert({
          nombre_propietario: v.nombre_propietario,
          telefono_propietario: v.telefono_propietario,
          correo_propietario: v.correo_propietario,
          direccion_inmueble: v.direccion_inmueble,
          monto_renta: montoRenta,
          status: 'partner_recibido',
          notas_internas: `Operacion recibida desde partner: ${ctx.agency.nombre_comercial}`,
        })
        .select('id')
        .single()
      if (propError) throw propError

      const { data: solicitud, error: solError } = await supabase
        .from('solicitudes_inquilino')
        .insert({
          nombre_completo: v.nombre_inquilino,
          telefono: v.telefono_inquilino,
          correo: v.correo_inquilino,
          inmueble_interes: v.direccion_inmueble,
          monto_renta_solicitada: montoRenta,
          tipo_solicitante: 'Persona fisica',
          status: 'pendiente',
          notas_juridico: `Operacion recibida desde partner: ${ctx.agency.nombre_comercial}`,
        })
        .select('id')
        .single()
      if (solError) throw solError

      const { data: operation, error: opError } = await supabase
        .from('partner_operations')
        .insert({
          partner_agency_id: ctx.agency.id,
          created_by: ctx.user.id,
          solicitud_inquilino_id: solicitud.id,
          propietario_id: propietario.id,
          status_partner: 'recibida',
          nombre_propietario: v.nombre_propietario,
          nombre_inquilino: v.nombre_inquilino,
          direccion_inmueble: v.direccion_inmueble,
          monto_renta: montoRenta,
          monto_poliza_estimado: montoPoliza,
          commission_rate: commissionRate,
          commission_estimated: calcCommission(montoPoliza, commissionRate),
          observaciones_publicas: 'Operacion recibida. El equipo de Emporio revisara la documentacion.',
          observaciones_internas: v.notas_partner || null,
        })
        .select('id')
        .single()
      if (opError) throw opError

      for (const [key, file] of Object.entries(files)) {
        await upload(operation.id, key, file)
      }

      window.location.href = `/partners/operaciones/${operation.id}`
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const FileBox = ({ name, label }) => (
    <div style={{ border: `1px dashed ${files[name] ? P.red : P.line}`, background: files[name] ? '#fff1f2' : '#fafafa', borderRadius: 9, padding: 14 }}>
      <label style={{ cursor: 'pointer', display: 'block' }}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setFiles(f => ({ ...f, [name]: e.target.files?.[0] }))} />
        <p style={{ margin: 0, color: P.text, fontSize: 13, fontWeight: 800 }}>{files[name]?.name || label}</p>
        <p style={{ margin: '3px 0 0', color: P.muted, fontSize: 11 }}>PDF, JPG o PNG</p>
      </label>
    </div>
  )

  if (loading || !ctx) return null

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Nueva operacion | Portal Partner</title></Head>
      <div style={{ maxWidth: 860 }}>
        <p style={{ margin: '0 0 4px', color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Nueva operacion</p>
        <h1 style={{ margin: '0 0 8px', color: P.ink, fontSize: 28 }}>Enviar expediente a Emporio</h1>
        <p style={{ margin: '0 0 20px', color: P.muted, fontSize: 14, lineHeight: 1.55 }}>Captura lo esencial y sube documentos disponibles. Nuestro equipo juridico continuara el proceso humano.</p>

        {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: 12, marginBottom: 16 }}>{error}</div>}

        <div ref={formRef} style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
          <h2 style={{ margin: '0 0 14px', color: P.ink, fontSize: 18 }}>Propietario e inmueble</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <Field label="Nombre del propietario" required><input name="nombre_propietario" style={input} /></Field>
            <Field label="Telefono propietario"><input name="telefono_propietario" style={input} /></Field>
            <Field label="Correo propietario"><input name="correo_propietario" type="email" style={input} /></Field>
            <Field label="Renta mensual"><input name="monto_renta" type="number" style={input} /></Field>
          </div>
          <Field label="Direccion del inmueble" required><textarea name="direccion_inmueble" style={textArea} /></Field>

          <div style={{ height: 1, background: P.line, margin: '8px 0 18px' }} />
          <h2 style={{ margin: '0 0 14px', color: P.ink, fontSize: 18 }}>Inquilino</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <Field label="Nombre del inquilino" required><input name="nombre_inquilino" style={input} /></Field>
            <Field label="Telefono inquilino"><input name="telefono_inquilino" style={input} /></Field>
            <Field label="Correo inquilino"><input name="correo_inquilino" type="email" style={input} /></Field>
            <Field label="Monto estimado de poliza"><input name="monto_poliza_estimado" type="number" style={input} /></Field>
          </div>

          <div style={{ height: 1, background: P.line, margin: '8px 0 18px' }} />
          <h2 style={{ margin: '0 0 14px', color: P.ink, fontSize: 18 }}>Documentos disponibles</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
            <FileBox name="propietario_identificacion" label="Identificacion propietario" />
            <FileBox name="propietario_predial" label="Predial / propiedad" />
            <FileBox name="inquilino_identificacion" label="Identificacion inquilino" />
            <FileBox name="inquilino_ingresos_1" label="Ingresos mes 1" />
            <FileBox name="inquilino_ingresos_2" label="Ingresos mes 2" />
            <FileBox name="inquilino_ingresos_3" label="Ingresos mes 3" />
          </div>
          <Field label="Notas para Emporio"><textarea name="notas_partner" style={textArea} placeholder="Contexto de la operacion, urgencia, fecha tentativa de firma, condiciones especiales..." /></Field>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <a href="/partners/dashboard" style={{ ...button, background: '#f4f4f5', color: P.text }}>Cancelar</a>
            <button onClick={handleSubmit} disabled={saving} style={{ ...button, background: P.red, color: '#fff', opacity: saving ? .65 : 1 }}>
              {saving ? 'Enviando...' : 'Enviar a Emporio'}
            </button>
          </div>
        </div>
      </div>
      <style jsx global>{`
        @media (max-width: 760px) {
          div[style*="repeat(2"] { grid-template-columns: 1fr !important; }
          div[style*="repeat(3"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </PartnerLayout>
  )
}
