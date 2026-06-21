import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { C, st } from '../../lib/polizaUtils'
import { usePermiso, SinAcceso } from '../../lib/permisos'

import TabExpedientes from '../../components/poliza/TabExpedientes'
import TabPropietarios from '../../components/poliza/TabPropietarios'
import TabSolicitudes from '../../components/poliza/TabSolicitudes'
import TabCajaPoliza from '../../components/poliza/TabCajaPoliza'
import TabCompraventa from '../../components/poliza/TabCompraventa'
import TabKpisPoliza from '../../components/poliza/TabKpisPoliza'
import ModalNuevoExpediente from '../../components/poliza/ModalNuevoExpediente'
import ModalExpediente from '../../components/poliza/ModalExpediente'
import ModalPropietario from '../../components/poliza/ModalPropietario'
import ModalSolicitud from '../../components/poliza/ModalSolicitud'
import ModalRenovacion from '../../components/poliza/ModalRenovacion'
import ModalVendedorCV from '../../components/poliza/ModalVendedorCV'
import ModalCompradorCV from '../../components/poliza/ModalCompradorCV'

const PROPIETARIOS_SELECT = 'id, nombre_propietario, telefono_propietario, correo_propietario, domicilio_propietario, rfc_propietario, direccion_inmueble, tipo_inmueble, monto_renta, precio_venta, tipo_operacion, tipo_persona_propietario, razon_social_propietario, status, notas_internas, created_at, contrato_administracion, forma_pago, banco, clabe, cuenta_bancaria, libre_gravamen, descripcion_inmueble, clave_elector_propietario, mascotas_permitidas, detalle_mascotas, institucion_gravamen'

export default function PolizaPanel() {
  const router = useRouter()
  const { cargando: permisoCargando, puedeVer, puedeEditar } = usePermiso('poliza')
  const [tab, setTab] = useState('expedientes')
  const [expedientes, setExpedientes] = useState([])
  const [propietarios, setPropietarios] = useState([])
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [caja, setCaja] = useState([])
  const [compradores, setCompradores] = useState([])
  const [subTabCV, setSubTabCV] = useState('vendedores')

  useEffect(() => {
    if (!permisoCargando && puedeVer) {
      loadTab('expedientes')
    }
  }, [permisoCargando, puedeVer])

  const loadTab = async (tabId) => {
    setLoading(true)
    if (tabId === 'expedientes') {
      const { data } = await supabase.from('poliza_expedientes').select('*').order('created_at', { ascending: false })
      setExpedientes(data || [])
    }
    if (tabId === 'propietarios' && propietarios.length === 0) {
      const { data } = await supabase.from('propietarios_inmuebles')
        .select(PROPIETARIOS_SELECT)
        .order('created_at', { ascending: false })
      setPropietarios(data || [])
    }
    if (tabId === 'solicitudes' && solicitudes.length === 0) {
      const { data } = await supabase.from('solicitudes_inquilino').select('*').order('created_at', { ascending: false })
      setSolicitudes(data || [])
    }
    if (tabId === 'caja' || tabId === 'kpis') {
      if (caja.length === 0) {
        const { data } = await supabase.from('poliza_caja').select('*').order('fecha', { ascending: false })
        setCaja(data || [])
      }
    }
    if (tabId === 'kpis' && expedientes.length === 0) {
      const { data } = await supabase.from('poliza_expedientes').select('*').order('created_at', { ascending: false })
      setExpedientes(data || [])
    }
    if (tabId === 'compraventa' && propietarios.length === 0) {
      const [{ data: prop }, { data: comp }] = await Promise.all([
        supabase.from('propietarios_inmuebles').select(PROPIETARIOS_SELECT).order('created_at', { ascending: false }),
        supabase.from('compradores').select('*').order('created_at', { ascending: false }),
      ])
      setPropietarios(prop || [])
      setCompradores(comp || [])
    }
    if (tabId === 'compraventa' && compradores.length === 0) {
      const { data } = await supabase.from('compradores').select('*').order('created_at', { ascending: false })
      setCompradores(data || [])
    }
    setLoading(false)
  }

  const loadAll = async () => {
    await loadTab(tab)
  }

  const propietariosFiltrados = propietarios.filter(p => !p.tipo_operacion || p.tipo_operacion === 'renta')
  const vendedoresFiltrados = propietarios.filter(p => p.tipo_operacion === 'venta')

  const hoy = new Date()
  const stats = {
    activas:    expedientes.filter(e => e.status === 'activo').length,
    vencidas:   expedientes.filter(e => e.status === 'vencido').length,
    porVencer:  expedientes.filter(e => {
      if (!e.fecha_vigencia) return false
      const dias = Math.ceil((new Date(e.fecha_vigencia + 'T12:00:00') - hoy) / (1000 * 60 * 60 * 24))
      return dias <= 60 && dias >= 0
    }).length,
    sinDictamen: solicitudes.filter(s => s.status === 'pendiente').length,
  }

  const tabs = [
    { id: 'expedientes', label: `Expedientes (${expedientes.length})` },
    { id: 'propietarios', label: `Propietarios (${propietariosFiltrados.length})` },
    { id: 'solicitudes', label: `Solicitudes (${solicitudes.length})` },
    { id: 'caja', label: '💰 Caja Póliza' },
    { id: 'compraventa', label: '🔑 Compraventa' },
    { id: 'kpis', label: '📊 KPIs' },
  ]

  const closeModal = () => { setModal(null); setSelected(null) }
  const closeAndReload = () => { closeModal(); loadTab(tab) }

  const cambiarTab = (tabId) => {
    setTab(tabId)
    loadTab(tabId)
  }

  if (permisoCargando) return null
  if (!puedeVer) return <SinAcceso />

  return (
    <div style={st.page}>
      <header style={st.header}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={st.logo} />
        <div>
          <p style={st.headerTitle}>Panel Jurídico</p>
          <p style={st.headerSub}>Pólizas · Contratos · Expedientes</p>
        </div>
        <nav style={st.nav}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => cambiarTab(t.id)}
              style={{ ...st.navBtn, ...(tab === t.id ? st.navBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </nav>
        {puedeEditar && (
          <div style={{ marginLeft: 'auto' }}>
            <button onClick={() => { setSelected(null); setModal('nuevo') }}
              style={{ ...st.btn, ...st.btnGold }}>
              + Nuevo expediente
            </button>
          </div>
        )}
      </header>

      {/* ── DASHBOARD DE RESUMEN ── */}
      {!loading && (
        <div style={{ background: '#b91c3c', padding: '12px 24px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { label: 'Pólizas activas',       value: stats.activas,     bg: 'rgba(255,255,255,0.15)', color: '#fff' },
              { label: 'Por vencer (60 días)',   value: stats.porVencer,   bg: stats.porVencer > 0 ? '#fef3c7' : 'rgba(255,255,255,0.15)', color: stats.porVencer > 0 ? '#92400e' : '#fff' },
              { label: 'Vencidas',               value: stats.vencidas,    bg: stats.vencidas > 0 ? '#fee2e2' : 'rgba(255,255,255,0.15)', color: stats.vencidas > 0 ? '#991b1b' : '#fff' },
              { label: 'Solicitudes pendientes', value: stats.sinDictamen, bg: stats.sinDictamen > 0 ? '#fef3c7' : 'rgba(255,255,255,0.15)', color: stats.sinDictamen > 0 ? '#92400e' : '#fff' },
            ].map((s, i) => (
              <div key={i} style={{ background: s.bg, borderRadius: 10, padding: '10px 20px', textAlign: 'center', minWidth: 140 }}>
                <div style={{ fontSize: 9, color: s.color === '#fff' ? 'rgba(255,255,255,0.7)' : '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <main style={st.main}>
        {loading ? (
          <div style={st.emptyState}><p>Cargando...</p></div>
        ) : (
          <>
            {tab === 'expedientes' && <TabExpedientes expedientes={expedientes} propietarios={propietarios} solicitudes={solicitudes} onSelect={e => { setSelected(e); setModal('expediente') }} onReload={loadAll} onRenovar={e => { setSelected(e); setModal('renovar') }} />}
            {tab === 'propietarios' && <TabPropietarios propietarios={propietariosFiltrados} onSelect={p => { setSelected(p); setModal('propietario') }} />}
            {tab === 'solicitudes' && <TabSolicitudes solicitudes={solicitudes} onSelect={s => { setSelected(s); setModal('solicitud') }} onNuevoExp={sol => { setSelected({ _solicitud: sol }); setModal('nuevo') }} />}
            {tab === 'caja' && <TabCajaPoliza movimientos={caja} onReload={loadAll} />}
            {tab === 'compraventa' && (
              <TabCompraventa
                vendedores={vendedoresFiltrados}
                compradores={compradores}
                subTab={subTabCV}
                onSubTab={setSubTabCV}
                onSelectVendedor={p => { setSelected(p); setModal('vendedor_cv') }}
                onSelectComprador={comp => { setSelected(comp); setModal('comprador_cv') }}
                onReload={loadAll}
              />
            )}
            {tab === 'kpis' && <TabKpisPoliza expedientes={expedientes} caja={caja} />}
          </>
        )}
      </main>

      {modal === 'vendedor_cv' && selected && <ModalVendedorCV vendedor={selected} compradores={compradores} onClose={closeModal} onSaved={closeAndReload} />}
      {modal === 'comprador_cv' && selected && <ModalCompradorCV comprador={selected} onClose={closeModal} onSaved={closeAndReload} />}
      {modal === 'nuevo' && <ModalNuevoExpediente propietarios={propietarios} solicitudes={solicitudes} prefill={selected?._solicitud} onClose={closeModal} onSaved={closeAndReload} />}
      {modal === 'expediente' && selected && <ModalExpediente expediente={selected} propietarios={propietarios} solicitudes={solicitudes} onClose={closeModal} onSaved={closeAndReload} />}
      {modal === 'propietario' && selected && <ModalPropietario propietario={selected} onClose={closeModal} onSaved={closeAndReload} onNuevoExp={() => { setModal('nuevo') }} />}
      {modal === 'renovar' && selected && <ModalRenovacion expediente={selected} onClose={closeModal} onSaved={closeAndReload} />}
      {modal === 'solicitud' && selected && <ModalSolicitud solicitud={selected} onClose={closeModal} onSaved={closeAndReload} onNuevoExp={() => { setSelected({ _solicitud: selected }); setModal('nuevo') }} />}
    </div>
  )
}
