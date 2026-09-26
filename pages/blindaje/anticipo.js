import Head from 'next/head'
import { useEffect, useRef, useState } from 'react'
import { externalPaymentEnabled } from '../../lib/externalPaymentClient.mjs'
const button = { border: 0, borderRadius: 10, padding: '12px 18px', background: '#b91c3c', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }
const input = { width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16, marginTop: 8 }
export default function Anticipo() {
  const token = useRef(''), uploadLock = useRef(false)
  const [context, setContext] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [role, setRole] = useState('inquilino'), [name, setName] = useState(''), [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false), [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!externalPaymentEnabled) { setLoading(false); return }
    let cancelled = false
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('pay') || ''
    fetch('/api/blindaje/external-payment/payment-public', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.current }), cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(async response => { const data = await response.json(); if (!cancelled) response.ok ? setContext(data) : setError(data.error || 'Esta liga de pago no está disponible.') })
      .catch(() => { if (!cancelled) setError('No pudimos consultar las instrucciones. Intenta más tarde.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  async function upload(event) {
    event.preventDefault()
    if (uploadLock.current || context?.status === 'validated') return
    if (!file || file.size > 5 * 1024 * 1024 || !['application/pdf','image/jpeg','image/png'].includes(file.type)) { setError('El comprobante debe ser PDF, JPG o PNG, de máximo 5 MB.'); return }
    if (role === 'tercero' && !name.trim()) { setError('Indica el nombre de quien realiza el pago.'); return }
    uploadLock.current = true; setBusy(true); setError('')
    try {
      // The file goes directly to the server-side Edge Function, never through Vercel or a public bucket API.
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/blindaje-payment-proof`, {
        method: 'POST', headers: { Authorization: `Bearer ${token.current}`, 'Content-Type': file.type,
          'X-Payer-Role': role, 'X-Payer-Name': encodeURIComponent(role === 'tercero' ? name.trim() : ''), 'X-File-Name': encodeURIComponent(file.name) },
        body: file, referrerPolicy: 'no-referrer', cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No pudimos recibir el comprobante.')
      setContext(previous => ({ ...previous, status: result.status }))
    } catch (err) { setError(err.message || 'No pudimos recibir el comprobante. Intenta de nuevo.') }
    finally { uploadLock.current = false; setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/blindaje/anticipo#pay=${token.current}`); setCopied(true) }
    catch (_) { setError('No pudimos copiar la liga. Puedes copiarla desde la barra de direcciones.') }
  }
  return <><Head><title>Anticipo de investigación — Emporio Blindaje Legal</title><meta name="referrer" content="no-referrer" /><meta name="robots" content="noindex,nofollow" /></Head>
    <main style={{ background: '#f8f8f8', minHeight: '100vh', padding: '32px 16px', boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif', color: '#374151' }}>
      <section style={{ maxWidth: 620, margin: '0 auto', padding: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, lineHeight: 1.6 }}>
        <p style={{ color: '#b91c3c', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>EMPORIO BLINDAJE LEGAL</p>
        <h1 style={{ fontSize: 27, lineHeight: 1.2 }}>Anticipo de investigación</h1>
        {!externalPaymentEnabled ? <p>Esta página no está disponible.</p> : loading ? <p role="status">Consultando instrucciones…</p> : <>
          {error && <p role="alert" style={{ background: '#fff0f3', padding: 12, borderRadius: 8 }}>{error}</p>}
          {context && <>
            <p>Folio: <strong>{context.folio}</strong></p>
            <p style={{ fontSize: 30, fontWeight: 800, margin: '12px 0' }}>$1,000 <span style={{ fontSize: 16 }}>MXN</span></p>
            {context.status !== 'validated' && <p>Para iniciar la investigación de arrendamiento es necesario cubrir el anticipo de $1,000 MXN.</p>}
            {context.status !== 'validated' && <p>El comprobante será revisado por nuestro equipo. La investigación no inicia hasta que el pago sea validado.</p>}
            <div style={{ background: '#f8f8f8', borderRadius: 12, padding: 16, overflowWrap: 'anywhere' }}>
              <dl style={{ margin: 0 }}><dt>Banco</dt><dd style={{ margin: '0 0 12px', fontWeight: 700 }}>{context.bank.banco}</dd>
                <dt>Titular</dt><dd style={{ margin: '0 0 12px', fontWeight: 700 }}>{context.bank.titular}</dd>
                <dt>CLABE</dt><dd style={{ margin: '0 0 12px', fontWeight: 700 }}>{context.bank.clabe}</dd>
                <dt>Concepto sugerido</dt><dd style={{ margin: 0, fontWeight: 700 }}>{context.folio}</dd></dl>
            </div>
            {context.status === 'proof_received' && <div role="status" style={{ marginTop: 20, padding: 16, background: '#fff7df', borderRadius: 10 }}><strong>Comprobante recibido</strong><div>Pendiente de validación por Emporio</div></div>}
            {context.status === 'validated' && <div role="status" style={{ marginTop: 20, padding: 16, background: '#dcfce7', borderRadius: 10 }}><strong>Anticipo validado</strong><div>Emporio confirmó el anticipo de investigación.</div></div>}
            {context.status === 'rejected' && <div role="status" style={{ marginTop: 20, padding: 16, background: '#fff7df', borderRadius: 10 }}><strong>Necesitamos un nuevo comprobante</strong><p>{context.rejection_reason}</p><div>Puedes reemplazar el comprobante usando esta misma liga.</div></div>}
            {context.status !== 'validated' && <form onSubmit={upload} style={{ marginTop: 24 }}>
              <label htmlFor="payer-role">¿Quién realiza el pago?</label>
              <select id="payer-role" value={role} onChange={e => setRole(e.target.value)} style={input}><option value="inquilino">Inquilino</option><option value="propietario">Propietario</option><option value="tercero">Otra persona</option></select>
              {role === 'tercero' && <label style={{ display: 'block', marginTop: 16 }} htmlFor="payer-name">Nombre del pagador<input id="payer-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} style={input} /></label>}
              <label htmlFor="proof" style={{ display: 'block', marginTop: 20 }}>Comprobante · PDF / JPG / PNG · máximo 5 MB</label>
              <input id="proof" type="file" required accept="application/pdf,image/jpeg,image/png" onChange={e => setFile(e.target.files[0] || null)} style={{ ...input, fontSize: 13 }} />
              <button disabled={busy} type="submit" style={{ ...button, width: '100%', marginTop: 16, opacity: busy ? .6 : 1 }}>{busy ? 'Recibiendo comprobante…' : context.status === 'proof_received' ? 'Reemplazar comprobante' : context.status === 'rejected' ? 'Enviar nuevo comprobante' : 'Enviar comprobante'}</button>
            </form>}
            <button type="button" onClick={copy} style={{ ...button, width: '100%', marginTop: 12, background: '#fff', border: '1px solid #b91c3c', color: '#b91c3c' }}>{copied ? 'Liga copiada' : 'Copiar liga de pago'}</button>
          </>}
        </>}
      </section>
    </main></>
}
