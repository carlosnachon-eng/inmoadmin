import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { C, st, CORREOS_PERMITIDOS } from '../../lib/polizaUtils'

import TabExpedientes from '../../components/poliza/TabExpedientes'
import TabPropietarios from '../../components/poliza/TabPropietarios'
import TabSolicitudes from '../../components/poliza/TabSolicitudes'
import TabCajaPoliza from '../../components/poliza/TabCajaPoliza'
import TabCompraventa from '../../components/poliza/TabCompraventa'
import ModalNuevoExpediente from '../../components/poliza/ModalNuevoExpediente'
import ModalExpediente from '../../components/poliza/ModalExpediente'
import ModalPropietario from '../../components/poliza/ModalPropietario'
import ModalSolicitud from '../../components/poliza/ModalSolicitud'
import ModalRenovacion from '../../components/poliza/ModalRenovacion'
import ModalVendedorCV from '../../components/poliza/ModalVendedorCV'
import ModalCompradorCV from '../../components/poliza/ModalCompradorCV'

export default function PolizaPanel() {
  const router = useRouter()
  const [tab, setTab] = useState('expedientes')
  const [expedientes, setExpedientes] = useState([])
  const [propietarios, setPropietarios] = useState([])
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [acceso, setAcceso] = useState(null)
  const [caja, setCaja] = useState([])
  const [compradores, setCompradores] = useState([])
  const [subTabCV, setSubTabCV] = useState('vendedores')

  useEffect(() => {
    const verificarAcceso = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/login'); return }
      const email = session.user.email
      if (CORREOS_PERMITIDOS.includes(email)) {
        setAcceso(true)
        loadAll()
      } else {
        setAcceso(false)
      }
    }
    verificarAcceso()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: exp }, { data: prop }, { data: sol }, { data: caj }, { data: comp }] = await Promise.all([
      supabase.from('poliza_expedientes').select('*').order('created_at', { ascending: false }),
      supabase.from('propietarios_inmuebles')
        .select('id, nombre_propietario, telefono_propietario, correo_propietario, domicilio_propietario, rfc_propietario, direccion_inmueble, tipo_inmueble, monto_renta, precio_venta, tipo_operacion, tipo_persona_propietario, razon_social_propietario, status, notas_internas, created_at, contrato_administracion, forma_pago, banco, clabe, cuenta_bancaria, libre_gravamen, descripcion_inmueble, clave_elector_propietario, mascotas_permitidas, detalle_mascotas, institucion_gravamen')
        .order('created_at', { ascending: false }),
      supabase.from('solicitudes_inquilino').select('*').order('created_at', { ascending: false }),
      supabase.from('poliza_caja').select('*').order('fecha', { ascending: false }),
      supabase.from('compradores').select('*').order('created_at', { ascending: false }),
    ])
    setExpedientes(exp || [])
    setPropietarios(prop || [])
    setSolicitudes(sol || [])
    setCaja(caj || [])
    setCompradores(comp || [])
    setLoading(false)
  }

  const propietariosFiltrados = propietarios.filter(p => !p.tipo_operacion || p.tipo_operacion === 'renta')
  const vendedoresFiltrados = propietarios.filter(p => p.tipo_operacion === 'venta')

  const tabs = [
    { id: 'expedientes', label: `Expedientes (${expedientes.length})` },
    { id: 'propietarios', label: `Propietarios (${propietariosFiltrados.length})` },
    { id: 'solicitudes', label: `Solicitudes (${solicitudes.length})` },
    { id: 'caja', label: '💰 Caja Póliza' },
    { id: 'compraventa', label: '🔑 Compraventa' },
  ]

  const closeModal = () => { setModal(null); setSelected(null) }
  const closeAndReload = () => { closeModal(); loadAll() }

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
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...st.navBtn, ...(tab === t.id ? st.navBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => { setSelected(null); setModal('nuevo') }}
            style={{ ...st.btn, ...st.btnGold }}>
            + Nuevo expediente
          </button>
        </div>
      </header>

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
