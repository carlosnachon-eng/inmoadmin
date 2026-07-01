import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

const red = '#b91c3c'
const line = '#e5e7eb'
const text = '#27272a'
const muted = '#71717a'

const input = {
  width: '100%',
  border: `1px solid ${line}`,
  borderRadius: 9,
  padding: '11px 12px',
  fontSize: 14,
  boxSizing: 'border-box',
}

const fileFields = [
  ['identificacion', 'Identificacion oficial'],
  ['comprobante_domicilio', 'Comprobante de domicilio'],
  ['comprobante_ingresos', 'Comprobante de ingresos'],
  ['constancia_fiscal', 'Constancia de situacion fiscal'],
]

export default function SolicitudObligado() {
  const router = useRouter()
  const { partner, operacion, participante } = router.query
  const [ctx, setCtx] = useState(null)
  const [values, setValues] = useState({})
  const [files, setFiles] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!partner || !operacion || !participante) return
    async function load() {
      try {
        const res = await fetch(`/api/partners/participant-public?partner=${encodeURIComponent(partner)}&operacion=${encodeURIComponent(operacion)}&participante=${encodeURIComponent(participante)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar la solicitud.')
        setCtx(data)
        setValues({
          nombre: data.participant?.nombre || '',
          email: data.participant?.email || '',
          telefono: data.participant?.telefono || '',
        })
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [partner, operacion, participante])

  const set = (k, v) => setValues(prev => ({ ...prev, [k]: v }))

  const readFile = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve(null)
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result })
    reader.onerror = () => reject(new Error('No se pudo leer un documento.'))
    reader.readAsDataURL(file)
  })

  const submit = async () => {
    if (!values.nombre || !values.email || !values.telefono) {
      setError('Completa nombre, correo y telefono.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const packedFiles = {}
      for (const [key] of fileFields) {
        if (files[key]) packedFiles[key] = await readFile(files[key])
      }
      const res = await fetch('/api/partners/participant-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner, operacion, participante, values, files: packedFiles }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar la solicitud.')
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <main style={page}><p style={{ color: muted }}>Cargando...</p></main>

  const agency = ctx?.agency
  const op = ctx?.operation

  if (done) return (
    <main style={page}>
      <section style={{ ...card, textAlign: 'center', maxWidth: 520 }}>
        <Brand agency={agency} />
        <h1 style={{ margin: '14px 0 8px', color: text, fontSize: 26 }}>Informacion recibida</h1>
        <p style={{ margin: 0, color: muted, lineHeight: 1.6 }}>Emporio Blindaje Legal revisara los datos y documentos del obligado solidario.</p>
      </section>
    </main>
  )

  return (
    <>
      <Head><title>Obligado solidario | Emporio Blindaje Legal</title></Head>
      <main style={page}>
        <section style={card}>
          <Brand agency={agency} />
          <p style={{ margin: '16px 0 4px', color: red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Obligado solidario</p>
          <h1 style={{ margin: '0 0 8px', color: text, fontSize: 28 }}>Completa tus datos</h1>
          <p style={{ margin: '0 0 18px', color: muted, fontSize: 14, lineHeight: 1.55 }}>
            Solicitud enviada por {agency?.nombre_comercial || 'inmobiliaria aliada'} para el inmueble {op?.direccion_inmueble || 'indicado'}.
          </p>

          {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: 12, marginBottom: 16, fontSize: 13, fontWeight: 750 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Field label="Nombre completo" required><input value={values.nombre || ''} onChange={e => set('nombre', e.target.value)} style={input} /></Field>
            <Field label="Correo" required><input type="email" value={values.email || ''} onChange={e => set('email', e.target.value)} style={input} /></Field>
            <Field label="Telefono" required><input value={values.telefono || ''} onChange={e => set('telefono', e.target.value)} style={input} /></Field>
            <Field label="RFC / CURP"><input value={values.rfc_curp || ''} onChange={e => set('rfc_curp', e.target.value)} style={input} /></Field>
            <Field label="Ocupacion"><input value={values.ocupacion || ''} onChange={e => set('ocupacion', e.target.value)} style={input} /></Field>
            <Field label="Relacion con el inquilino"><input value={values.relacion_inquilino || ''} onChange={e => set('relacion_inquilino', e.target.value)} style={input} /></Field>
          </div>
          <Field label="Domicilio"><textarea value={values.domicilio || ''} onChange={e => set('domicilio', e.target.value)} style={{ ...input, minHeight: 76, resize: 'vertical' }} /></Field>

          <div style={{ height: 1, background: line, margin: '18px 0' }} />
          <h2 style={{ margin: '0 0 12px', color: text, fontSize: 18 }}>Documentos</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {fileFields.map(([key, label]) => (
              <Field key={key} label={label}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFiles(prev => ({ ...prev, [key]: e.target.files?.[0] || null }))} style={{ ...input, padding: 8 }} />
              </Field>
            ))}
          </div>

          <button onClick={submit} disabled={saving} style={{ width: '100%', marginTop: 12, background: red, color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontWeight: 850, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .65 : 1 }}>
            {saving ? 'Enviando...' : 'Enviar informacion'}
          </button>
        </section>
      </main>
      <style jsx global>{`
        @media (max-width: 720px) {
          div[style*="repeat(2"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  )
}

function Brand({ agency }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {agency?.logo_url ? (
        <img src={agency.logo_url} alt={agency.nombre_comercial || 'Partner'} style={{ width: 54, height: 54, borderRadius: 10, border: `1px solid ${line}`, objectFit: 'contain', background: '#fff' }} />
      ) : (
        <div style={{ width: 54, height: 54, borderRadius: 10, background: agency?.brand_color || red, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 950 }}>{agency?.nombre_comercial?.[0] || 'P'}</div>
      )}
      <div>
        <p style={{ margin: 0, color: text, fontWeight: 900 }}>{agency?.nombre_comercial || 'Emporio Partner'}</p>
        <p style={{ margin: '3px 0 0', color: muted, fontSize: 12 }}>en alianza con Emporio Blindaje Legal</p>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', marginBottom: 5, color: text, fontSize: 12, fontWeight: 850 }}>{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  )
}

const page = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #f8fafc, #fff1f2)',
  padding: 18,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'system-ui, sans-serif',
}

const card = {
  width: '100%',
  maxWidth: 760,
  background: '#fff',
  border: `1px solid ${line}`,
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 22px 60px rgba(39,39,42,.12)',
}
