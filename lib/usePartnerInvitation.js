import { useEffect, useState } from 'react'

export const invitationsEnabled = process.env.NEXT_PUBLIC_BLINDAJE_PARTNER_INVITATIONS_ENABLED === 'true'
export const invitationUnavailable = 'Esta invitación ya no está disponible. Solicita una nueva liga a tu inmobiliaria.'

export function usePartnerInvitation(role) {
  const [context, setContext] = useState({ status: invitationsEnabled ? 'checking' : 'none' })
  useEffect(() => {
    if (!invitationsEnabled) return
    let cancelled = false
    const params = new URLSearchParams(window.location.hash.slice(1))
    if (!params.has('invite')) { setContext({ status: 'none' }); return }
    const token = params.get('invite')
    setContext({ status: 'pending' })
    fetch('/api/partners/invitation-public', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }), cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(async response => response.ok ? response.json() : null)
      .then(data => {
        if (cancelled) return
        if (!data?.valid || data.role !== role) { setContext({ status: 'invalid' }); return }
        setContext({ status: 'valid', kind: 'secure_partner_invitation', token, data })
      }).catch(() => { if (!cancelled) setContext({ status: 'invalid' }) })
    return () => { cancelled = true }
  }, [role])
  return context
}

export async function linkInvitedSubmission(context, tipo, record_id) {
  try {
    const response = await fetch('/api/partners/link-submission-invited', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, referrerPolicy: 'no-referrer',
      body: JSON.stringify({ token: context.token, tipo, record_id }) })
    return response.ok && (await response.json()).ok === true
  } catch (_) { return false }
}
