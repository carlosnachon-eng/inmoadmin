import { useEffect, useState } from 'react'
import Head from 'next/head'
import { supabase } from '../../lib/supabase'
import { getPartnerContext } from '../../lib/partners'
import { Field, P, button, input } from '../../components/partners/PartnerLayout'

export default function PartnerLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function check() {
      const ctx = await getPartnerContext()
      if (ctx.agency) window.location.href = '/partners/dashboard'
      else setChecking(false)
    }
    check()
  }, [])

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
    if (loginError) {
      setError('Email o contrasena incorrectos')
      setLoading(false)
      return
    }

    const ctx = await getPartnerContext()
    setLoading(false)
    if (!ctx.agency) {
      await supabase.auth.signOut()
      setError('Este usuario no tiene acceso activo al Portal Partner.')
      return
    }
    window.location.href = '/partners/dashboard'
  }

  if (checking) return null

  return (
    <>
      <Head>
        <title>Portal Partner | Emporio Blindaje Legal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{ minHeight: '100vh', background: `linear-gradient(130deg, rgba(39,39,42,.92), rgba(127,29,46,.88)), url("https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1500&q=80") center/cover`, display: 'grid', placeItems: 'center', padding: 18, fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ width: '100%', maxWidth: 410, background: '#fff', borderRadius: 18, padding: 34, boxShadow: '0 22px 60px rgba(0,0,0,.28)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 58, objectFit: 'contain', marginBottom: 12 }} />
            <p style={{ margin: 0, color: P.red, fontSize: 12, fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase' }}>Blindaje Legal Partner</p>
            <h1 style={{ margin: '6px 0 0', color: P.ink, fontSize: 22 }}>Portal para inmobiliarias aliadas</h1>
          </div>

          {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: '10px 12px', marginBottom: 14, fontSize: 13, fontWeight: 750 }}>{error}</div>}

          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="aliado@inmobiliaria.com" style={input} />
          </Field>
          <Field label="Contrasena">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="********" style={input} />
          </Field>
          <button onClick={handleLogin} disabled={loading || !email || !password} style={{ ...button, width: '100%', minHeight: 46, background: P.red, color: '#fff', opacity: loading ? .65 : 1 }}>
            {loading ? 'Entrando...' : 'Entrar al portal'}
          </button>
          <p style={{ margin: '16px 0 0', color: P.muted, fontSize: 12, lineHeight: 1.45, textAlign: 'center' }}>
            Este portal es exclusivo para inmobiliarias aliadas de Emporio Blindaje Legal.
          </p>
        </section>
      </main>
    </>
  )
}
