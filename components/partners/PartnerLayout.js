import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export const P = {
  red: '#b91c3c',
  redDark: '#7f1d2e',
  bg: '#f5f5f6',
  card: '#ffffff',
  ink: '#27272a',
  text: '#3f3f46',
  muted: '#71717a',
  line: '#e4e4e7',
  green: '#0f766e',
  amber: '#b45309',
  blue: '#1d4ed8',
  purple: '#6d28d9',
}

export const button = {
  border: 'none',
  borderRadius: 9,
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
}

export const input = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${P.line}`,
  borderRadius: 9,
  padding: '11px 12px',
  fontSize: 14,
  outline: 'none',
  background: '#fff',
  color: P.text,
}

export function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', marginBottom: 5, color: P.text, fontSize: 13, fontWeight: 750 }}>
        {label}{required && <span style={{ color: P.red }}> *</span>}
      </label>
      {hint && <p style={{ margin: '0 0 6px', color: P.muted, fontSize: 11, lineHeight: 1.4 }}>{hint}</p>}
      {children}
    </div>
  )
}

export function PartnerBadge({ status, statuses }) {
  const meta = statuses?.[status] || { label: status || 'Recibida', tone: 'neutral' }
  const tones = {
    green: { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' },
    red: { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
    amber: { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
    blue: { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
    purple: { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
    neutral: { bg: '#f4f4f5', color: '#52525b', border: '#e4e4e7' },
  }
  const t = tones[meta.tone] || tones.neutral
  return (
    <span style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 999, padding: '4px 9px', fontSize: 11, fontWeight: 850, whiteSpace: 'nowrap' }}>
      {meta.label}
    </span>
  )
}

export default function PartnerLayout({ agency, children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 760)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const nav = [
    { href: '/partners/dashboard', label: 'Operaciones' },
    { href: '/partners/nueva-operacion', label: 'Nueva operacion' },
    { href: '/partners/comisiones', label: 'Comisiones' },
  ]

  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/partners/login'
  }

  const NavLinks = () => (
    <>
      {nav.map((item) => (
        <a key={item.href} href={item.href} style={{ color: P.text, textDecoration: 'none', fontSize: 13, fontWeight: 800, padding: '9px 10px', borderRadius: 8 }}>
          {item.label}
        </a>
      ))}
      <button onClick={logout} style={{ ...button, background: '#f4f4f5', color: P.muted, padding: '9px 10px' }}>Salir</button>
    </>
  )

  return (
    <div style={{ minHeight: '100vh', background: P.bg, color: P.ink, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <header style={{ background: '#fff', borderBottom: `1px solid ${P.line}`, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/partners/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', color: P.ink, minWidth: 0 }}>
            <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 34, width: 'auto', objectFit: 'contain' }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11, color: P.red, fontWeight: 900, letterSpacing: .8, textTransform: 'uppercase' }}>Blindaje Legal Partner</p>
              <p style={{ margin: 0, fontSize: 12, color: P.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agency?.nombre_comercial || 'Inmobiliaria aliada'}</p>
            </div>
          </a>

          {isMobile ? (
            <button onClick={() => setMenuOpen(v => !v)} style={{ ...button, marginLeft: 'auto', background: '#f4f4f5', color: P.text }}>Menu</button>
          ) : (
            <nav style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
              <NavLinks />
            </nav>
          )}
        </div>
        {isMobile && menuOpen && (
          <nav style={{ borderTop: `1px solid ${P.line}`, padding: '10px 18px 14px', display: 'grid', gap: 5 }}>
            <NavLinks />
          </nav>
        )}
      </header>
      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '26px 18px 48px' }}>
        {children}
      </main>
    </div>
  )
}
