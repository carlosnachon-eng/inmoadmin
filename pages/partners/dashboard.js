import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import PartnerLayout, { P, PartnerBadge, button } from '../../components/partners/PartnerLayout'
import { fmtMoney, getPartnerContext, loadPartnerOperations, PARTNER_STATUS } from '../../lib/partners'

export default function PartnerDashboard() {
  const [ctx, setCtx] = useState(null)
  const [operations, setOperations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const nextCtx = await getPartnerContext()
        if (!nextCtx.agency) {
          window.location.href = '/partners/login'
          return
        }
        if (nextCtx.agency.status !== 'activo') {
          window.location.href = '/partners/pendiente'
          return
        }
        setCtx(nextCtx)
        setOperations(await loadPartnerOperations(nextCtx.agency.id))
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const stats = useMemo(() => {
    const abiertas = operations.filter(o => !['activa', 'rechazada', 'cancelada'].includes(o.status_partner)).length
    return {
      total: operations.length,
      abiertas,
      activas: operations.filter(o => o.status_partner === 'activa').length,
      comisionGenerada: operations.reduce((sum, o) => sum + (Number(o.commission_generated) || 0), 0),
      comisionPagada: operations.reduce((sum, o) => sum + (Number(o.commission_paid) || 0), 0),
    }
  }, [operations])

  const renovaciones = useMemo(() => {
    const hoy = new Date()
    return operations
      .filter(o => o.poliza_expedientes?.fecha_vigencia && o.status_partner === 'activa')
      .map(o => {
        const fecha = new Date(`${o.poliza_expedientes.fecha_vigencia}T12:00:00`)
        const dias = Math.ceil((fecha - hoy) / (1000 * 60 * 60 * 24))
        return { ...o, diasRenovacion: dias }
      })
      .filter(o => o.diasRenovacion <= 60 && o.diasRenovacion >= -15)
      .sort((a, b) => a.diasRenovacion - b.diasRenovacion)
  }, [operations])

  if (loading || !ctx) return null

  return (
    <PartnerLayout agency={ctx.agency}>
      <Head><title>Operaciones | Portal Partner</title></Head>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <p style={{ margin: '0 0 4px', color: P.red, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Operaciones</p>
          <h1 style={{ margin: 0, color: P.ink, fontSize: 28 }}>Seguimiento juridico</h1>
          <p style={{ margin: '6px 0 0', color: P.muted, fontSize: 14 }}>Aqui ves solo las operaciones enviadas por tu inmobiliaria.</p>
        </div>
        <a href="/partners/nueva-operacion" style={{ ...button, background: P.red, color: '#fff' }}>Nueva operacion</a>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 9, padding: 12, marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 14, marginBottom: 18, alignItems: 'stretch' }}>
        <TariffPanel />
        <RequirementsPanel />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          ['Total', stats.total],
          ['En proceso', stats.abiertas],
          ['Activas', stats.activas],
          ['Comision generada', fmtMoney(stats.comisionGenerada)],
          ['Comision pagada', fmtMoney(stats.comisionPagada)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 9, padding: 16 }}>
            <p style={{ margin: '0 0 6px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{label}</p>
            <p style={{ margin: 0, color: P.ink, fontSize: 22, fontWeight: 900 }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, overflow: 'hidden' }}>
        {operations.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center' }}>
            <p style={{ margin: '0 0 8px', color: P.ink, fontSize: 18, fontWeight: 850 }}>Aun no hay operaciones</p>
            <p style={{ margin: '0 0 18px', color: P.muted, fontSize: 14 }}>Crea la primera para que Emporio inicie el proceso juridico.</p>
            <a href="/partners/nueva-operacion" style={{ ...button, background: P.red, color: '#fff' }}>Crear primera operacion</a>
          </div>
        ) : (
          operations.map((op, index) => (
            <a key={op.id} href={`/partners/operaciones/${op.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 150px 150px 150px', gap: 12, alignItems: 'center', padding: '15px 16px', borderTop: index ? `1px solid ${P.line}` : 'none', color: 'inherit', textDecoration: 'none' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, color: P.ink, fontSize: 14, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.nombre_inquilino || 'Inquilino pendiente'}</p>
                <p style={{ margin: '3px 0 0', color: P.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.direccion_inmueble || 'Sin direccion'} · {op.folio || op.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <PartnerBadge status={op.status_partner} statuses={PARTNER_STATUS} />
              <span style={{ color: P.text, fontSize: 13, fontWeight: 750 }}>{fmtMoney(op.monto_poliza_final || op.monto_poliza_estimado)}</span>
              <span style={{ color: P.green, fontSize: 13, fontWeight: 850 }}>{fmtMoney(op.commission_generated || op.commission_estimated)}</span>
            </a>
          ))
        )}
      </div>

      {renovaciones.length > 0 && (
        <div style={{ marginTop: 18, background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 18 }}>
          <p style={{ margin: '0 0 4px', color: P.green, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Renovaciones proximas</p>
          <h2 style={{ margin: '0 0 12px', color: P.ink, fontSize: 20 }}>Oportunidades de nueva comision</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {renovaciones.map(op => (
              <a key={op.id} href={`/partners/operaciones/${op.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 9, padding: 12, color: 'inherit', textDecoration: 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, color: P.ink, fontSize: 13, fontWeight: 850 }}>{op.nombre_inquilino || 'Operacion'}</p>
                  <p style={{ margin: '3px 0 0', color: P.muted, fontSize: 12 }}>{op.direccion_inmueble || '-'}</p>
                </div>
                <span style={{ color: '#065f46', fontSize: 12, fontWeight: 950, whiteSpace: 'nowrap' }}>
                  {op.diasRenovacion < 0 ? `Vencio hace ${Math.abs(op.diasRenovacion)} dias` : `Vence en ${op.diasRenovacion} dias`}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      <style jsx global>{`
        @media (max-width: 900px) {
          div[style*="repeat(5"] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          a[style*="grid-template-columns: minmax(220px"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </PartnerLayout>
  )
}

const tariffRows = [
  ['Hasta $7,000', '$2,800'],
  ['$7,001 a $10,000', '$3,200'],
  ['$10,001 a $15,000', '$3,800'],
  ['$15,001 a $20,000', '$4,500'],
  ['$20,001 a $25,000', '$5,200'],
  ['$25,001 a $30,000', '$6,100'],
  ['$30,001 a $40,000', '$9,500'],
  ['$40,001 a $50,000', '$12,500'],
  ['$50,001 en adelante', '25% de renta'],
]

function TariffPanel() {
  return (
    <section style={{ background: '#fff', border: `1px solid ${P.line}`, borderRadius: 10, padding: 18, boxShadow: '0 1px 3px rgba(39,39,42,.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <p style={{ margin: '0 0 4px', color: P.red, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Tarifas vigentes</p>
          <h2 style={{ margin: 0, color: P.ink, fontSize: 18 }}>Poliza juridica Emporio</h2>
          <p style={{ margin: '5px 0 0', color: P.muted, fontSize: 12 }}>Precios de referencia segun renta mensual.</p>
        </div>
        <a href="https://www.emporioinmobiliario.com.mx/blindaje-legal" target="_blank" rel="noreferrer" style={{ color: P.red, fontSize: 12, fontWeight: 900, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Ver pagina →
        </a>
      </div>
      <div style={{ border: `1px solid ${P.line}`, borderRadius: 9, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', background: '#fafafa', borderBottom: `1px solid ${P.line}` }}>
          <p style={{ margin: 0, padding: '9px 12px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Renta mensual</p>
          <p style={{ margin: 0, padding: '9px 12px', color: P.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', textAlign: 'right' }}>Costo</p>
        </div>
        {tariffRows.map(([range, cost], index) => (
          <div key={range} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', borderTop: index ? `1px solid ${P.line}` : 'none', background: index % 2 ? '#fff' : '#fcfcfc' }}>
            <p style={{ margin: 0, padding: '8px 12px', color: P.text, fontSize: 12, fontWeight: 750 }}>{range}</p>
            <p style={{ margin: 0, padding: '8px 12px', color: P.ink, fontSize: 12, fontWeight: 900, textAlign: 'right' }}>{cost}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: 10 }}>
          <p style={{ margin: 0, color: P.red, fontSize: 11, fontWeight: 900 }}>Todos los precios son mas IVA</p>
        </div>
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 10 }}>
          <p style={{ margin: 0, color: '#065f46', fontSize: 11, fontWeight: 900 }}>Comision solo con poliza cobrada y activa</p>
        </div>
      </div>
    </section>
  )
}

function RequirementsPanel() {
  const groups = [
    {
      title: 'Inquilino',
      items: ['Solicitud completa', 'Identificacion oficial', 'Comprobantes de ingresos', 'Referencias y datos laborales'],
    },
    {
      title: 'Propietario',
      items: ['Registro del inmueble', 'Identificacion oficial', 'Predial o documento de propiedad', 'Datos de contacto y condiciones'],
    },
  ]
  return (
    <section style={{ background: '#27272a', color: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 12px 28px rgba(39,39,42,.12)' }}>
      <p style={{ margin: '0 0 4px', color: '#fda4af', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Para avanzar rapido</p>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Requisitos basicos</h2>
      <div style={{ display: 'grid', gap: 12 }}>
        {groups.map(group => (
          <div key={group.title} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 9, padding: 13 }}>
            <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 900 }}>{group.title}</p>
            <div style={{ display: 'grid', gap: 7 }}>
              {group.items.map(item => (
                <div key={item} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', color: P.red, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 950 }}>✓</span>
                  <p style={{ margin: 0, color: 'rgba(255,255,255,.86)', fontSize: 12, lineHeight: 1.35 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p style={{ margin: '13px 0 0', color: 'rgba(255,255,255,.62)', fontSize: 12, lineHeight: 1.45 }}>
        Si falta algo, Emporio lo marcara en observaciones de la operacion.
      </p>
    </section>
  )
}
