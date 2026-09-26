import { useEffect, useState } from 'react'
import { externalPaymentEnabled, storedClaim, recoverPayment, navigateToPayment } from './externalPaymentClient.mjs'

export function useExternalPaymentRecovery({ role, claimRef, invitation, partnerStatus, selection, ready }) {
  const key = externalPaymentEnabled && ready
    ? invitation.status === 'valid' ? `partner:${invitation.token}`
      : invitation.status === 'none' && ['none', 'invalid'].includes(partnerStatus) && selection?.origen_operacion === 'b2c' ? 'b2c' : null
    : null
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    setResult({ key, status: 'pending' })
    ;(async () => {
      try {
        const claim = key === 'b2c' ? storedClaim(claimRef, role) : null
        const payment = key === 'b2c' && !claim ? null
          : await recoverPayment({ role, claim, invitationToken: key === 'b2c' ? null : invitation.token })
        if (cancelled) return
        if (payment?.payment_token) { navigateToPayment(payment); return }
        setResult({ key, status: 'ready' })
      } catch (_) {
        if (!cancelled) setResult({ key, status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [key, role, claimRef, attempt])
  return {
    blocked: Boolean(key && (result?.key !== key || result.status !== 'ready')),
    error: Boolean(key && result?.key === key && result.status === 'error'),
    retry: () => { setResult(null); setAttempt(value => value + 1) },
  }
}
