import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const button = { padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 600 }
const filters = [['proof_received','Por revisar'],['pending','Esperando comprobante'],['rejected','Rechazados'],['validated','Validados'],['all','Todos']]
const reasons = ['No pudimos identificar el depósito.', 'El comprobante no permite verificar el pago.', 'El importe no corresponde al anticipo de $1,000 MXN.', 'El comprobante corresponde a otra operación.', 'Otro.']
export default function TabAnticiposExternos({ puedeEditar }) {
  const [items,setItems] = useState([]), [filter,setFilter] = useState('proof_received'), [error,setError] = useState(''), [loading,setLoading] = useState(true)
  const [review,setReview] = useState(null), [reason,setReason] = useState(''), [confirmed,setConfirmed] = useState(false), [busy,setBusy] = useState(false)
  const lock = useRef(false)
  async function request(path, body) {
    const { data: { session } } = await supabase.auth.getSession()
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session?.access_token || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación')
    return result
  }
  async function refresh() {
    setLoading(true)
    try { const result = await request('/api/blindaje/internal/investigation-payments'); setItems(result.items); setError('') }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])
  async function proof(payment) {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try { const result = await request('/api/blindaje/internal/payment-proof-url', { payment_id: payment.id }); if (tab) tab.location.href = result.url; else setError('Permite abrir una pestaña para consultar el comprobante.') }
    catch (e) { tab?.close(); setError(e.message) }
  }
  async function submitReview(e) {
    e.preventDefault()
    if (lock.current || !puedeEditar || (review.action === 'validate' && !confirmed)) return
    lock.current = true; setBusy(true); setError('')
    try { await request('/api/blindaje/internal/review-investigation-payment', { payment_id: review.id, action: review.action, ...(review.action === 'reject' ? { rejection_reason: reason } : {}) }); setReview(null); await refresh() }
    catch (e) { setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  async function investigate(id) {
    if (lock.current || !puedeEditar) return
    lock.current = true; setBusy(true); setError('')
    try {
      const result = await request('/api/analizar-solicitud', { solicitud_id: id, tipo_ejecucion: 'inicial' })
      await refresh()
      if (result.detalles?.sin_documentos) throw new Error('Documentos pendientes')
    }
    catch (_) { setError('Pago validado. La investigación no pudo iniciarse; puedes reintentar.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section aria-label="Anticipos externos">
    <h2>Anticipos externos</h2>
    <p>Revisa el comprobante y confirma el depósito en la cuenta bancaria antes de validar.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {filters.map(([value,label]) => <button key={value} style={{ ...button, background: filter === value ? '#fce7ef' : '#fff' }} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}
      <button style={button} onClick={refresh} disabled={loading}>Actualizar</button>
    </div>
    {error && <p role="alert" style={{ color: '#991b1b' }}>{error}</p>}
    {loading && <p role="status">Consultando anticipos…</p>}
    {!loading && !items.some(row => filter === 'all' || row.payment.status === filter) && <p>No hay anticipos en este estado.</p>}
    {items.filter(row => filter === 'all' || row.payment.status === filter).map(({ case: c, payment: p, context: x }) => <article key={c.id} style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 12, marginBottom: 16, background: '#fff', overflowWrap: 'anywhere' }}>
      <h3 style={{ marginTop: 0 }}>{c.folio} · {c.origin_type === 'partner' ? 'Partner' : 'B2C'}</h3>
      <p><strong>{x.nombre_inquilino || x.nombre_propietario || c.folio}</strong><br />{x.direccion_inmueble || 'Inmueble por confirmar'}{x.agencia && <><br />{x.agencia}</>}</p>
      <p>Pagador: {({ inquilino: 'Inquilino', propietario: 'Propietario', tercero: 'Tercero' })[p.payer_role] || 'Por confirmar'}{p.payer_name ? ` · ${p.payer_name}` : ''}<br />Comprobante: {p.proof_submitted_at ? new Date(p.proof_submitted_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'Pendiente'}<br />Estado: {filters.find(([value]) => value === p.status)?.[1]}</p>
      {p.status === 'rejected' && <p>Motivo que verá el cliente: {p.rejection_reason}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {p.proof_original_name && <button style={button} onClick={() => proof(p)}>Ver comprobante</button>}
        {puedeEditar && p.status === 'proof_received' && <><button disabled={busy} style={{ ...button, background: '#b91c3c', color: '#fff' }} onClick={() => { setReview({ id: p.id, action: 'validate', folio: c.folio }); setConfirmed(false) }}>Validar $1,000</button><button disabled={busy} style={button} onClick={() => { setReview({ id: p.id, action: 'reject', folio: c.folio }); setReason('') }}>Rechazar</button></>}
        {p.status === 'validated' && (x.solicitud_id ? x.pre_viabilidad !== null ? <p>Investigación iniciada</p> : puedeEditar && <button disabled={busy} style={button} onClick={() => investigate(x.solicitud_id)}>Iniciar investigación</button> : <p>Anticipo validado. Falta recibir la solicitud del inquilino.</p>)}
      </div>
    </article>)}
    {review && <div role="dialog" aria-modal="true" aria-label="Revisar anticipo" style={{ position: 'fixed', inset: 0, background: '#0008', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
      <form onSubmit={submitReview} style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 520, width: '100%', boxSizing: 'border-box' }}>
        <h3>{review.folio}</h3>
        {review.action === 'validate' ? <label><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Confirmo que el depósito de $1,000 MXN fue identificado en la cuenta bancaria de Emporio.</label> : <>
          <label htmlFor="public-reason">Motivo que verá el cliente</label>
          <select aria-label="Motivo sugerido" value={reasons.includes(reason) ? reason : ''} onChange={e => setReason(e.target.value === 'Otro.' ? '' : e.target.value)} style={{ width: '100%', margin: '12px 0', padding: 10 }}><option value="">Selecciona un motivo</option>{reasons.map(text => <option key={text}>{text}</option>)}</select>
          <textarea id="public-reason" required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', minHeight: 100 }} />
          <p>Usa un texto neutral. No incluyas notas internas, datos personales ni acusaciones.</p>
        </>}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}><button disabled={busy || (review.action === 'validate' && !confirmed)} style={button}>{busy ? 'Guardando…' : review.action === 'validate' ? 'Confirmar validación' : 'Confirmar rechazo'}</button><button type="button" disabled={busy} style={button} onClick={() => setReview(null)}>Cancelar</button></div>
        {error && <p role="alert">{error}</p>}
      </form>
    </div>}
  </section>
}
