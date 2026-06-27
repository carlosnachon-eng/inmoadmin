import { useEffect, useState } from 'react'
import Head from 'next/head'
import PartnerLayout, { P, button } from '../../components/partners/PartnerLayout'
import { getPartnerContext } from '../../lib/partners'
import { supabase } from '../../lib/supabase'

export default function PartnerPendiente() {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const nextCtx = await getPartnerContext()
      if (!nextCtx.agency) {
        window.location.href = '/partners/login'
        return
      }
      if (nextCtx.agency.status === 'activo') {
        window.location.href = '/partners/dashboard'
        return
      }
      setCtx(nextCtx)
      setLoading(false)
    }
    load()
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/partners/login'
  }

  if (loading || !ctx) return null

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Acceso en revision | Portal Partner</title></Head>
      <section style={{ maxWidth: 680, margin: '40px auto', background: '#fff', border: `1px solid ${P.line}`, borderRadius: 14, padding: 32, textAlign: 'center' }}>
        <p style={{ margin: '0 0 8px', color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Acceso pendiente</p>
        <h1 style={{ margin: '0 0 12px', color: P.ink, fontSize: 30 }}>Estamos revisando tu solicitud</h1>
        <p style={{ margin: '0 auto 22px', maxWidth: 500, color: P.muted, fontSize: 15, lineHeight: 1.65 }}>
          Tu inmobiliaria ya esta registrada. Emporio debe aprobarla antes de que puedas crear operaciones y generar ligas personalizadas.
        </p>
        <div style={{ background: '#fafafa', border: `1px solid ${P.line}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <p style={{ margin: 0, color: P.ink, fontWeight: 900 }}>{ctx.agency.nombre_comercial}</p>
          <p style={{ margin: '4px 0 0', color: P.muted, fontSize: 13 }}>Estatus: {ctx.agency.status}</p>
        </div>
        <button onClick={logout} style={{ ...button, background: '#f4f4f5', color: P.text }}>Salir</button>
      </section>
    </PartnerLayout>
  )
}
