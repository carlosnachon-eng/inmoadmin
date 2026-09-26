import { useState } from 'react'
import { P, button, input } from './PartnerLayout'
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
        setLinks(previous => ({ ...previous, [role]: null })); setMessage(`Ligas de ${role} revocadas.`)
      } else {
        const page = role === 'inquilino' ? 'solicitud-inquilino' : 'registro-propietario'
        setLinks(previous => ({ ...previous, [role]: `${window.location.origin}/${page}#invite=${data.token}` }))
      }
    } catch (_) { setMessage('No se pudo completar la acción. Verifica tu sesión e intenta nuevamente.') }
    finally { setBusy(false) }
  }
  const primaryButton = { ...button, background: P.red, color: '#fff', padding: '8px 11px', fontSize: 12 }
  const secondaryButton = { ...button, background: '#f4f4f5', color: P.text, padding: '8px 11px', fontSize: 12 }
  return <section aria-label="Ligas para tus clientes" style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 20 }}>
    <h2 style={{ margin: '0 0 8px', color: P.ink, fontSize: 18 }}>Ligas para tus clientes</h2>
    <p style={{ margin: '0 0 14px', color: P.muted, fontSize: 13, lineHeight: 1.5 }}>
      Genera una liga para cada parte de la operación. Cada liga identifica la operación y muestra únicamente la información correspondiente.
    </p>
    {['inquilino', 'propietario'].map(role => <div key={role} role="group" aria-label={role === 'inquilino' ? 'Inquilino' : 'Propietario'} style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 9, padding: 12, marginBottom: 10 }}>
      <p style={{ margin: '0 0 7px', color: P.text, fontSize: 13, fontWeight: 850 }}>{role === 'inquilino' ? 'Solicitud para inquilino' : 'Registro para propietario'}</p>
      <button type="button" disabled={busy} style={{ ...primaryButton, opacity: busy ? .6 : 1 }} onClick={() => act(role)}>Generar liga para {role}</button>
      {links[role] && <div>
        <p style={{ margin: '10px 0', color: P.muted, fontSize: 12, overflowWrap: 'anywhere' }}>{links[role]}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={primaryButton} onClick={async () => {
            try { await navigator.clipboard.writeText(links[role]); setMessage('Liga copiada.') }
            catch (_) { setMessage('No se pudo copiar. Copia la liga mostrada.') }
          }}>Copiar liga</button>
          <a href={links[role]} target="_blank" rel="noopener noreferrer" style={secondaryButton}>Abrir</a>
        </div>
      </div>}
    </div>)}
    <div style={{ marginTop: 18 }}>
      <label htmlFor="invitation-revoke-role" style={{ display: 'block', marginBottom: 8, color: P.text, fontSize: 13, fontWeight: 850 }}>Administrar ligas</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select id="invitation-revoke-role" value={revokeRole} onChange={e => setRevokeRole(e.target.value)} style={{ ...input, width: 'auto' }}>
          <option value="inquilino">Inquilino</option><option value="propietario">Propietario</option>
        </select>
        <button type="button" disabled={busy} style={{ ...secondaryButton, opacity: busy ? .6 : 1 }} onClick={() => act(revokeRole, true)}>Revocar liga</button>
      </div>
    </div>
    <p role="status" style={{ margin: message ? '12px 0 0' : 0, color: P.muted, fontSize: 13 }}>{message}</p>
  </section>
}
