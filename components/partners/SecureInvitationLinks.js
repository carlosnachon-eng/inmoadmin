import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function SecureInvitationLinks({ operationId }) {
  const [links, setLinks] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [revokeRole, setRevokeRole] = useState('inquilino')
  async function act(role, revoke = false) {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/partners/invitations', { method: revoke ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ operation_id: operationId, role }) })
      const data = await response.json()
      if (!response.ok) throw new Error('No se pudo completar la acción. Verifica tu sesión e intenta nuevamente.')
      if (revoke) {
        setLinks(previous => ({ ...previous, [role]: null })); setMessage(`Ligas seguras de ${role} revocadas.`)
      } else {
        const page = role === 'inquilino' ? 'solicitud-inquilino' : 'registro-propietario'
        setLinks(previous => ({ ...previous, [role]: `${window.location.origin}/${page}#invite=${data.token}` }))
      }
    } catch (_) { setMessage('No se pudo completar la acción. Verifica tu sesión e intenta nuevamente.') }
    finally { setBusy(false) }
  }
  return <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
    <h2>Ligas seguras para Blindaje</h2>
    <p>Vigencia: 30 días. Generar otra liga no revoca las anteriores.</p>
    {['inquilino', 'propietario'].map(role => <div key={role} style={{ marginBottom: 18 }}>
      <button type="button" disabled={busy} onClick={() => act(role)}>Generar liga segura para {role}</button>
      {links[role] && <div>
        <p style={{ overflowWrap: 'anywhere' }}>{links[role]}</p>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(links[role]); setMessage('Liga copiada.') }
          catch (_) { setMessage('No se pudo copiar. Copia la liga mostrada.') }
        }}>Copiar liga de {role}</button>{' '}
        <a href={links[role]} target="_blank" rel="noopener noreferrer">Abrir liga de {role}</a>
      </div>}
    </div>)}
    <label>Revocar por rol: <select value={revokeRole} onChange={e => setRevokeRole(e.target.value)}>
      <option value="inquilino">Inquilino</option><option value="propietario">Propietario</option>
    </select></label>{' '}
    <button type="button" disabled={busy} onClick={() => act(revokeRole, true)}>Revocar ligas seguras</button>
    <p role="status">{message}</p>
  </section>
}
