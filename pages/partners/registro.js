import { useState } from 'react'
import Head from 'next/head'
import { Field, P, button, input } from '../../components/partners/PartnerLayout'

const textArea = { ...input, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }

export default function PartnerRegistro() {
  const [form, setForm] = useState({
    nombre_comercial: '',
    razon_social: '',
    nombre_contacto: '',
    email: '',
    telefono: '',
    ciudad: '',
    website: '',
    logo_url: '',
    brand_color: '#b91c3c',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/partners/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la inmobiliaria.')
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <>
      <Head><title>Registro recibido | Emporio Partner</title></Head>
      <main style={pageStyle}>
        <section style={cardStyle}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 58, objectFit: 'contain', marginBottom: 18 }} />
          <h1 style={{ margin: '0 0 10px', color: P.ink, fontSize: 26 }}>Solicitud recibida</h1>
          <p style={{ margin: '0 0 20px', color: P.muted, fontSize: 15, lineHeight: 1.6 }}>
            Tu inmobiliaria quedo en revision. Cuando Emporio apruebe el acceso, podras entrar al portal y generar ligas personalizadas para tus clientes.
          </p>
          <a href="/partners/login" style={{ ...button, background: P.red, color: '#fff', width: '100%' }}>Ir al login</a>
        </section>
      </main>
    </>
  )

  return (
    <>
      <Head>
        <title>Quiero ser Partner | Emporio Blindaje Legal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={pageStyle}>
        <section style={{ ...cardStyle, maxWidth: 720, textAlign: 'left' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 58, objectFit: 'contain', marginBottom: 12 }} />
            <p style={{ margin: 0, color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.2 }}>Emporio Blindaje Legal Partner</p>
            <h1 style={{ margin: '6px 0 0', color: P.ink, fontSize: 26 }}>Solicita acceso para tu inmobiliaria</h1>
          </div>

          {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: 12, marginBottom: 16, fontSize: 13, fontWeight: 750 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <Field label="Nombre comercial" required><input value={form.nombre_comercial} onChange={e => set('nombre_comercial', e.target.value)} style={input} /></Field>
            <Field label="Razon social"><input value={form.razon_social} onChange={e => set('razon_social', e.target.value)} style={input} /></Field>
            <Field label="Nombre de contacto"><input value={form.nombre_contacto} onChange={e => set('nombre_contacto', e.target.value)} style={input} /></Field>
            <Field label="Email de acceso" required><input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={input} /></Field>
            <Field label="Telefono"><input value={form.telefono} onChange={e => set('telefono', e.target.value)} style={input} /></Field>
            <Field label="Ciudad / zona"><input value={form.ciudad} onChange={e => set('ciudad', e.target.value)} style={input} /></Field>
            <Field label="Sitio web o Instagram"><input value={form.website} onChange={e => set('website', e.target.value)} style={input} /></Field>
            <Field label="Color de marca"><input type="color" value={form.brand_color} onChange={e => set('brand_color', e.target.value)} style={{ ...input, height: 43, padding: 5 }} /></Field>
          </div>
          <Field label="URL del logo" hint="Pega un link publico del logo. Despues podemos reemplazarlo por carga de archivo.">
            <textarea value={form.logo_url} onChange={e => set('logo_url', e.target.value)} style={textArea} placeholder="https://..." />
          </Field>
          <Field label="Contrasena" required hint="Minimo 8 caracteres. Tu acceso quedara pendiente hasta aprobacion de Emporio.">
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} style={input} />
          </Field>

          <button onClick={submit} disabled={loading} style={{ ...button, background: P.red, color: '#fff', width: '100%', minHeight: 46, opacity: loading ? .65 : 1 }}>
            {loading ? 'Enviando...' : 'Solicitar acceso'}
          </button>
          <p style={{ margin: '14px 0 0', color: P.muted, fontSize: 12, textAlign: 'center' }}>
            Emporio revisara tu solicitud antes de activar el portal.
          </p>
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

const pageStyle = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #f5f5f6, #fff1f2)',
  display: 'grid',
  placeItems: 'center',
  padding: 18,
  fontFamily: 'system-ui, sans-serif',
}

const cardStyle = {
  width: '100%',
  maxWidth: 430,
  background: '#fff',
  border: `1px solid ${P.line}`,
  borderRadius: 18,
  padding: 34,
  boxShadow: '0 22px 60px rgba(39,39,42,.12)',
  textAlign: 'center',
}
