import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import PartnerLayout, { Field, P, button, input } from '../../components/partners/PartnerLayout'
import { calcPolicyPrice, fmtMoney, getPartnerContext } from '../../lib/partners'
import { supabase } from '../../lib/supabase'

const textArea = { ...input, minHeight: 86, resize: 'vertical', fontFamily: 'inherit' }

export default function NuevaOperacionPartner() {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rentPreview, setRentPreview] = useState('')
  const formRef = useRef(null)

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
      setLoading(false)
    }
    load()
  }, [])

  const values = () => {
    const data = {}
    formRef.current?.querySelectorAll('[name]').forEach(el => { data[el.name] = el.value })
    return data
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
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/partners/operations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify(v),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'No se pudo crear la operacion')

      window.location.href = `/partners/operaciones/${result.operation_id}`
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !ctx) return null

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Nueva operacion | Portal Partner</title></Head>
      <div style={{ maxWidth: 860 }}>
        <p style={{ margin: '0 0 4px', color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Nueva operacion</p>
        <h1 style={{ margin: '0 0 8px', color: P.ink, fontSize: 28 }}>Crear operacion</h1>
        <p style={{ margin: '0 0 20px', color: P.muted, fontSize: 14, lineHeight: 1.55 }}>Captura lo minimo. Despues enviaremos ligas personalizadas para que propietario e inquilino llenen los formularios completos.</p>

        {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: 12, marginBottom: 16 }}>{error}</div>}

        <div ref={formRef} style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
          <h2 style={{ margin: '0 0 14px', color: P.ink, fontSize: 18 }}>Propietario e inmueble</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <Field label="Nombre del propietario" required><input name="nombre_propietario" style={input} /></Field>
            <Field label="Telefono propietario"><input name="telefono_propietario" style={input} /></Field>
            <Field label="Correo propietario"><input name="correo_propietario" type="email" style={input} /></Field>
            <Field label="Renta mensual">
              <input name="monto_renta" type="number" value={rentPreview} onChange={e => setRentPreview(e.target.value)} style={input} />
            </Field>
          </div>
          <Field label="Direccion del inmueble" required><textarea name="direccion_inmueble" style={textArea} /></Field>
          <PolicyPreview rent={rentPreview} />

          <div style={{ height: 1, background: P.line, margin: '8px 0 18px' }} />
          <h2 style={{ margin: '0 0 14px', color: P.ink, fontSize: 18 }}>Inquilino</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <Field label="Nombre del inquilino" required><input name="nombre_inquilino" style={input} /></Field>
            <Field label="Telefono inquilino"><input name="telefono_inquilino" style={input} /></Field>
            <Field label="Correo inquilino"><input name="correo_inquilino" type="email" style={input} /></Field>
          </div>

          <Field label="Notas para Emporio"><textarea name="notas_partner" style={textArea} placeholder="Contexto de la operacion, urgencia, fecha tentativa de firma, condiciones especiales..." /></Field>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <a href="/partners/dashboard" style={{ ...button, background: '#f4f4f5', color: P.text }}>Cancelar</a>
            <button onClick={handleSubmit} disabled={saving} style={{ ...button, background: P.red, color: '#fff', opacity: saving ? .65 : 1 }}>
              {saving ? 'Creando...' : 'Crear operacion y generar ligas'}
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

function PolicyPreview({ rent }) {
  const price = calcPolicyPrice(rent)
  if (!price) return (
    <div style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 14, margin: '4px 0 18px' }}>
      <p style={{ margin: 0, color: P.muted, fontSize: 13 }}>Captura la renta mensual para estimar el costo de la poliza.</p>
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 10, padding: 16, margin: '4px 0 18px' }}>
      <div>
        <p style={{ margin: '0 0 4px', color: P.red, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Costo estimado de poliza</p>
        <p style={{ margin: 0, color: P.text, fontSize: 13 }}>Rango: {price.label}{price.formula ? ` · ${price.formula}` : ''}</p>
        <p style={{ margin: '4px 0 0', color: P.muted, fontSize: 11 }}>Precio mas IVA. Emporio confirma el monto final antes de activar la poliza.</p>
      </div>
      <p style={{ margin: 0, color: P.red, fontSize: 26, fontWeight: 950 }}>{fmtMoney(price.price)}</p>
    </div>
  )
}
