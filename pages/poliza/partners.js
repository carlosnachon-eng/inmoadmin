import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st } from '../../lib/polizaUtils'
import { usePermiso, SinAcceso } from '../../lib/permisos'
import TabPartners from '../../components/poliza/TabPartners'

export default function PolizaPartnersPage() {
  const { cargando: permisoCargando, puedeVer } = usePermiso('poliza')
  const [operaciones, setOperaciones] = useState([])
  const [agencias, setAgencias] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [{ data: ops }, { data: ags }] = await Promise.all([
      supabase
        .from('partner_operations')
        .select('*, partner_agencies:partner_agency_id(nombre_comercial)')
        .order('created_at', { ascending: false }),
      supabase
        .from('partner_agencies')
        .select('*')
        .order('created_at', { ascending: false }),
    ])
    setOperaciones(ops || [])
    setAgencias(ags || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!permisoCargando && puedeVer) load()
  }, [permisoCargando, puedeVer])

  if (permisoCargando) return null
  if (!puedeVer) return <SinAcceso />

  return (
    <div style={st.page}>
      <header style={st.header}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={st.logo} />
        <div>
          <p style={st.headerTitle}>Partners Blindaje Legal</p>
          <p style={st.headerSub}>Aliados · Operaciones · Comisiones</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <a href="/poliza" style={{ ...st.btn, ...st.btnGhost, textDecoration: 'none' }}>Volver a Póliza</a>
        </div>
      </header>

      <main style={st.main}>
        {loading ? (
          <div style={st.emptyState}><p>Cargando partners...</p></div>
        ) : (
          <TabPartners operaciones={operaciones} agencias={agencias} onReload={load} />
        )}
      </main>
    </div>
  )
}
