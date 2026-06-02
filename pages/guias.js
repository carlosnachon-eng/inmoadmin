import Head from 'next/head'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const USUARIOS_PERMITIDOS = [
  'carlos.nachon@emporioinmobiliario.mx',
  'guillermo@emporioinmobiliario.com.mx',
  'ariannet81@gmail.com',
  'angelicamomox@gmail.com',
  'rddd298@gmail.com',
  'ivanmtzco@gmail.com',
  'nextelmoto2@gmail.com',
]

const SECCIONES = [
  { id: 'descargas', label: '📥 Descargas', color: '#C8102E' },
  { id: 'compra', label: '🏠 Proceso de Compra', color: '#C8102E' },
  { id: 'renta', label: '🔑 Proceso de Renta', color: '#1a1a2e' },
  { id: 'requisitos', label: '📋 Requisitos Comprador', color: '#0369a1' },
  { id: 'poliza', label: '🛡️ Póliza Jurídica', color: '#065f46' },
  { id: 'cuenta', label: '🏦 Datos Bancarios', color: '#92400e' },
  { id: 'checklist', label: '✅ Checklist Operativo', color: '#7c3aed' },
]

const DESCARGAS = [
  {
    nombre: 'Brochure Torre Zaia',
    descripcion: 'Para enviar a prospectos de compra. Tipologías, precios, amenidades y esquema de pago.',
    archivo: '/docs/brochure-torre-zaia.pdf',
    color: '#C8102E',
    emoji: '🏢',
  },
  {
    nombre: 'Brochure Equiah',
    descripcion: 'Para enviar a prospectos. Modelos Encino y Sauce, amenidades y ubicación junto a Val\'Quirico.',
    archivo: '/docs/brochure-equiah.pdf',
    color: '#2d3a2e',
    emoji: '🌿',
  },
  {
    nombre: 'Políticas de Compra',
    descripcion: 'Para explicar al cliente comprador. Apartado, plazos, enganche, escrituración y devoluciones.',
    archivo: '/docs/politicas-compra.pdf',
    color: '#1a1a2e',
    emoji: '📋',
  },
  {
    nombre: 'Políticas de Arrendamiento',
    descripcion: 'Para explicar al arrendatario. Requisitos, condiciones, póliza jurídica y pagarés.',
    archivo: '/docs/politicas-renta.pdf',
    color: '#1a1a2e',
    emoji: '🔑',
  },
]

const CONTENIDO = {
  compra: {
    titulo: 'Proceso de Compra',
    subtitulo: 'Políticas para el cliente comprador',
    bloques: [
      {
        numero: '01',
        titulo: 'Apartado de Reserva',
        contenido: 'El comprador entrega $10,000 MXN fijos para reservar el inmueble. Este apartado asegura la disponibilidad por 7 días naturales, retirándola del mercado.',
        destacado: '$10,000 MXN · 7 días naturales',
        tipo: 'info',
      },
      {
        numero: '02',
        titulo: 'Formas de pago del apartado',
        contenido: 'Efectivo directamente en oficinas, o transferencia bancaria a:',
        destacado: 'Banbajío · CLABE: 030650900021403290\nGrupo Inmobiliario Nachón Torres S.A. de C.V.',
        tipo: 'banco',
      },
      {
        numero: '03',
        titulo: 'Plazo para firma de promesa',
        contenido: 'Una vez entregado el apartado, ambas partes tienen máximo 7 días naturales para firmar el Contrato de Promesa de Compraventa.',
        destacado: '7 días naturales máximo',
        tipo: 'plazo',
      },
      {
        numero: '04',
        titulo: 'Enganche',
        contenido: 'El monto del enganche se define de mutuo acuerdo entre comprador y propietario, y queda estipulado en la promesa de compraventa. Forma parte del precio total.',
        destacado: 'Comúnmente 10% — pactable',
        tipo: 'info',
      },
      {
        numero: '05',
        titulo: 'Inicio de escrituración',
        contenido: 'En paralelo a la promesa, se inicia la escrituración. El comprador gestiona su financiamiento: crédito bancario, Infonavit o contado.',
        destacado: null,
        tipo: 'info',
      },
      {
        numero: '06',
        titulo: 'Devolución del apartado',
        contenido: 'El apartado NO es reembolsable si el comprador cancela. Solo se devuelve si la venta no puede concretarse por causas ajenas al comprador (incumplimiento del vendedor, problema legal del inmueble).',
        destacado: '⚠️ No reembolsable por decisión del comprador',
        tipo: 'alerta',
      },
      {
        numero: '07',
        titulo: 'Elección de notaría',
        contenido: 'Le corresponde al comprador elegir la notaría, salvo acuerdo contrario. Los costos notariales corren por cuenta del comprador.',
        destacado: null,
        tipo: 'info',
      },
      {
        numero: '08',
        titulo: 'Entrega del inmueble',
        contenido: 'La entrega física se realiza únicamente cuando el precio ha sido liquidado en su totalidad, incluyendo enganche y saldo restante.',
        destacado: '100% del precio liquidado antes de la entrega',
        tipo: 'info',
      },
      {
        numero: '09',
        titulo: 'Lo que debes decirle al comprador antes del apartado',
        contenido: 'Emporio actúa como intermediario. El apartado no es promesa de compraventa. El inventario no se congela sin avance real. Si no firma en 7 días, pierde el apartado.',
        destacado: '⚠️ Informar siempre antes de cobrar',
        tipo: 'alerta',
      },
    ],
  },
  renta: {
    titulo: 'Proceso de Renta',
    subtitulo: 'Requisitos y condiciones para arrendatarios',
    bloques: [
      {
        numero: '01',
        titulo: 'Requisitos del inquilino',
        contenido: 'Para iniciar el proceso de renta, el candidato debe presentar:',
        lista: [
          'INE vigente',
          '3 últimos meses de comprobante de ingresos',
          'Llenar la solicitud de arrendamiento',
          'Cubrir el costo de la Póliza Jurídica',
        ],
        destacado: null,
        tipo: 'lista',
      },
      {
        numero: '02',
        titulo: 'Condiciones del contrato',
        contenido: 'Las condiciones estándar de arrendamiento en Emporio son:',
        lista: [
          '1 mes de renta como pago inicial',
          '1 mes de depósito en garantía',
          'Contrato por 1 año',
          'Póliza Jurídica obligatoria (la paga el inquilino)',
        ],
        destacado: null,
        tipo: 'lista',
      },
      {
        numero: '03',
        titulo: 'Póliza Jurídica',
        contenido: 'Es obligatoria en todos los arrendamientos. Generalmente la paga el inquilino. Incluye investigación del candidato, contrato redactado por especialistas, cobertura jurídica durante toda la vigencia y recuperación judicial si aplica.',
        destacado: 'Ver tabla de precios en sección Póliza Jurídica',
        tipo: 'info',
      },
      {
        numero: '04',
        titulo: 'Proceso de investigación',
        contenido: 'El candidato sube su documentación a nuestra plataforma. Se verifican ingresos, referencias personales/laborales/familiares, Buró México y validación de documentos. Se emite un dictamen formal.',
        destacado: '5 filtros antes de la firma',
        tipo: 'info',
      },
      {
        numero: '05',
        titulo: 'Pagarés de arrendamiento',
        contenido: 'En todo arrendamiento se firman pagarés independientes al contrato. Son instrumentos jurídicos que respaldan el pago de rentas y permiten la recuperación expedita del inmueble en caso de incumplimiento.',
        lista: [
          'Se firman al momento de la firma del contrato',
          'Son independientes al contrato — son un documento aparte',
          'Forman parte del blindaje jurídico de la operación',
          'Le dan al propietario una vía legal más rápida de recuperación',
          'El inquilino debe estar informado antes de la firma',
        ],
        destacado: 'Nunca se firma contrato sin los pagarés correspondientes',
        tipo: 'alerta',
      },
      {
        numero: '06',
        titulo: 'Datos bancarios para pagos',
        contenido: 'Mismo que compraventa:',
        destacado: 'Banbajío · CLABE: 030650900021403290 · Grupo Inmobiliario Nachón Torres S.A. de C.V.',
        tipo: 'banco',
      },
    ],
  },
  requisitos: {
    titulo: 'Requisitos del Comprador',
    subtitulo: 'Documentación para crédito y compraventa',
    bloques: [
      {
        numero: null,
        titulo: 'Documentos Generales',
        contenido: 'Aplican para todos los tipos de crédito y operaciones de compraventa:',
        checklist: [
          'Copia de Acta de Nacimiento digital (del año en curso)',
          'Copia de Acta de Matrimonio digital, en su caso (del año en curso)',
          'Constancia de Situación Fiscal con fecha no mayor a 2 meses',
          'Copia de credencial de elector (INE vigente)',
          'Copia de comprobante de domicilio reciente (luz o telefonía)',
          'CURP',
          'Correo electrónico y número telefónico del solicitante',
        ],
        destacado: null,
        tipo: 'checklist',
      },
      {
        numero: null,
        titulo: 'Documentos Infonavit',
        contenido: 'Adicionales para crédito hipotecario Infonavit:',
        checklist: [
          'Precalificación Infonavit — micuenta.infonavit.org.mx (imagen completa con encabezado y pie de página)',
          'Tabla de Amortización',
          'Confirmar registro en Afore',
          'Pantalla Mi Cuenta Infonavit con datos personales (nombre, RFC, CURP)',
          'Curso Saber Más Para Decidir Mejor — micuenta.infonavit.org.mx',
          'Reporte Cotizaciones IMSS — serviciosdigitales.imss.gob.mx',
          '3 Referencias Personales (nombre completo, teléfono, dirección y correo)',
          'Número de teléfono de oficina para validación de datos',
          'Pago de avalúo (costo según valor del inmueble)',
          'Notificación de Inicio de Trámite emitida por la empresa para firma de escritura',
        ],
        destacado: null,
        tipo: 'checklist',
      },
      {
        numero: null,
        titulo: 'Crediterreno (adicional si aplica)',
        contenido: null,
        checklist: [
          'Declaración Anual',
          'Declaratoria Crediterreno',
          'Comprobante de domicilio y de pago de referencias personales',
        ],
        destacado: null,
        tipo: 'checklist',
      },
      {
        numero: null,
        titulo: '💡 Tip para el asesor',
        contenido: 'Pide siempre primero los documentos generales. Si el cliente va con Infonavit, agrégale la lista adicional. No esperes a tener todo para avanzar — con INE y precalificación puedes iniciar.',
        destacado: null,
        tipo: 'info',
      },
    ],
  },
  poliza: {
    titulo: 'Póliza Jurídica Emporio',
    subtitulo: 'Blindaje Legal — Precios y cobertura',
    bloques: [
      {
        numero: null,
        titulo: '¿Qué incluye?',
        contenido: null,
        lista: [
          'Investigación completa del candidato (ingresos, referencias, Buró México)',
          'Dictamen formal del candidato',
          'Contrato de arrendamiento redactado por especialistas',
          'Póliza jurídica formal con vigencia de 12 meses',
          'Cobranza extrajudicial en caso de incumplimiento',
          'Recuperación judicial del inmueble si es necesario',
          'Protección ante extinción de dominio',
          'Atención con abogada especializada durante toda la vigencia',
        ],
        destacado: null,
        tipo: 'lista',
      },
      {
        numero: null,
        titulo: 'Tabla de precios (+ IVA · vigencia 12 meses)',
        contenido: null,
        tabla: [
          { renta: 'Hasta $7,000', costo: '$2,800' },
          { renta: '$7,001 a $10,000', costo: '$3,200' },
          { renta: '$10,001 a $15,000', costo: '$3,800' },
          { renta: '$15,001 a $20,000', costo: '$4,500' },
          { renta: '$20,001 a $25,000', costo: '$5,200' },
          { renta: '$25,001 a $30,000', costo: '$6,100' },
          { renta: '$30,001 a $40,000', costo: '$9,500' },
          { renta: '$40,001 a $50,000', costo: '$12,500' },
          { renta: '$50,001 en adelante', costo: '25% de 1 renta' },
        ],
        destacado: null,
        tipo: 'tabla',
      },
      {
        numero: null,
        titulo: '¿Quién la paga?',
        contenido: 'Generalmente el inquilino. Se cobra antes de la firma del contrato. Sin póliza no se firma.',
        destacado: '⚠️ Sin póliza no hay contrato',
        tipo: 'alerta',
      },
    ],
  },
  cuenta: {
    titulo: 'Datos Bancarios',
    subtitulo: 'Cuenta para apartados y pagos',
    bloques: [
      {
        numero: null,
        titulo: 'Cuenta oficial Emporio',
        contenido: 'Esta es la única cuenta autorizada para recibir pagos de apartados, depósitos y pólizas jurídicas.',
        destacado: null,
        tipo: 'info',
      },
      {
        numero: null,
        titulo: null,
        contenido: null,
        datos: [
          { label: 'Banco', valor: 'Banbajío' },
          { label: 'Titular', valor: 'Grupo Inmobiliario Nachón Torres S.A. de C.V.' },
          { label: 'CLABE', valor: '030650900021403290' },
        ],
        destacado: null,
        tipo: 'datos',
      },
      {
        numero: null,
        titulo: '¿Para qué se usa?',
        contenido: null,
        lista: [
          'Apartados de compraventa ($10,000 MXN)',
          'Depósitos de arrendamiento',
          'Pago de Póliza Jurídica',
          'Cualquier pago relacionado con operaciones de Emporio',
        ],
        destacado: null,
        tipo: 'lista',
      },
      {
        numero: null,
        titulo: '⚠️ Importante',
        contenido: 'Nunca proporciones otra cuenta bancaria al cliente. Si hay dudas sobre un pago, dirige al cliente a Administración.',
        destacado: null,
        tipo: 'alerta',
      },
    ],
  },
  checklist: {
    titulo: 'Checklist Operativo',
    subtitulo: 'Lo que debes verificar antes de cada operación',
    bloques: [
      {
        numero: null,
        titulo: 'Antes de cobrar un apartado de compraventa',
        contenido: null,
        checklist: [
          'Comprador informado que Emporio es intermediario',
          'Comprador informado que el apartado no es promesa de compraventa',
          'Monto del apartado definido ($10,000 MXN)',
          'Vigencia explicada (7 días naturales)',
          'Plazo de firma de promesa explicado',
          'Forma de pago marcada (crédito o contado)',
          'Enganche explicado conforme a políticas',
          'Cobro realizado por Administración',
          'Recibo oficial firmado y entregado al comprador',
          'No se prometieron excepciones',
        ],
        destacado: null,
        tipo: 'checklist',
      },
      {
        numero: null,
        titulo: 'Antes de iniciar un proceso de renta',
        contenido: null,
        checklist: [
          'INE del candidato recibida y vigente',
          '3 meses de comprobante de ingresos recibidos',
          'Solicitud de arrendamiento llenada',
          'Póliza Jurídica cotizada y explicada al candidato',
          'Expediente enviado a Administración para investigación',
          'No se prometió fecha de firma antes del dictamen',
          'Pagarés explicados al candidato (se firman junto con el contrato)',
          'Candidato informado que los pagarés son independientes al contrato',
        ],
        destacado: null,
        tipo: 'checklist',
      },
      {
        numero: null,
        titulo: 'Regla de oro',
        contenido: 'Ante cualquier duda o situación fuera de lo normal, no improvises. Consulta a Administración antes de comprometerte con el cliente.',
        destacado: '📞 Administración: María José',
        tipo: 'alerta',
      },
    ],
  },
}

export default function Guias() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [seccionActiva, setSeccionActiva] = useState('compra')
  const [checklistMarcado, setChecklistMarcado] = useState({})

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const toggleCheck = (key) => setChecklistMarcado(prev => ({ ...prev, [key]: !prev[key] }))

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  )

  if (!session || !USUARIOS_PERMITIDOS.includes(session.user.email)) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <div style={{ textAlign: 'center', background: '#fff', padding: 40, borderRadius: 16, border: '1px solid #e5e7eb' }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, marginBottom: 16 }} />
        <p style={{ fontSize: 16, fontWeight: 700, color: '#4a4a4a', marginBottom: 8 }}>Sin acceso</p>
        <button onClick={() => supabase.auth.signOut()} style={{ background: '#C8102E', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 700 }}>Salir</button>
      </div>
    </div>
  )

  const seccion = CONTENIDO[seccionActiva] || null
  const colorActivo = SECCIONES.find(s => s.id === seccionActiva)?.color || '#C8102E'

  const renderBloque = (bloque, i) => {
    const key = `${seccionActiva}-${i}`

    if (bloque.tipo === 'tabla') return (
      <div key={i} style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: '#1a1a2e', marginBottom: 12 }}>{bloque.titulo}</p>
        <div style={{ border: '1px solid #f3f4f6', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: colorActivo }}>
            <div style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: '#fff' }}>Renta mensual</div>
            <div style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: '#fff', borderLeft: '1px solid rgba(255,255,255,0.2)' }}>Costo de póliza + IVA</div>
          </div>
          {bloque.tabla.map((row, j) => (
            <div key={j} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: j % 2 === 0 ? '#fff' : '#fafafa', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ padding: '11px 16px', fontSize: 13, color: '#374151' }}>{row.renta}</div>
              <div style={{ padding: '11px 16px', fontSize: 13, fontWeight: 800, color: colorActivo, borderLeft: '1px solid #f3f4f6' }}>{row.costo}</div>
            </div>
          ))}
        </div>
      </div>
    )

    if (bloque.tipo === 'checklist') return (
      <div key={i} style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: '#1a1a2e', marginBottom: 12 }}>{bloque.titulo}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bloque.checklist.map((item, j) => {
            const itemKey = `${key}-${j}`
            const marcado = checklistMarcado[itemKey]
            return (
              <div key={j} onClick={() => toggleCheck(itemKey)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', background: marcado ? '#f0fdf4' : '#fff', border: `1px solid ${marcado ? '#6ee7b7' : '#e5e7eb'}`, borderRadius: 10, cursor: 'pointer' }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${marcado ? '#065f46' : '#d1d5db'}`, background: marcado ? '#065f46' : '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                  {marcado && <span style={{ color: '#fff', fontSize: 12, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 14, color: marcado ? '#065f46' : '#374151', lineHeight: 1.5, textDecoration: marcado ? 'line-through' : 'none' }}>{item}</span>
              </div>
            )
          })}
        </div>
        <button onClick={() => {
          const newState = { ...checklistMarcado }
          bloque.checklist.forEach((_, j) => { newState[`${key}-${j}`] = false })
          setChecklistMarcado(newState)
        }} style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Limpiar checklist
        </button>
      </div>
    )

    if (bloque.tipo === 'datos') return (
      <div key={i} style={{ background: '#1a1a2e', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
        {bloque.datos.map((d, j) => (
          <div key={j} style={{ marginBottom: j < bloque.datos.length - 1 ? 14 : 0 }}>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>{d.label}</p>
            <p style={{ fontSize: d.label === 'CLABE' ? 20 : 14, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: d.label === 'CLABE' ? 2 : 0 }}>{d.valor}</p>
          </div>
        ))}
      </div>
    )

    return (
      <div key={i} style={{ marginBottom: 20, border: `1px solid ${bloque.tipo === 'alerta' ? '#fecaca' : '#f3f4f6'}`, borderRadius: 14, overflow: 'hidden' }}>
        {(bloque.numero || bloque.titulo) && (
          <div style={{ background: bloque.tipo === 'alerta' ? '#fef2f2' : bloque.tipo === 'banco' ? '#1a1a2e' : '#f8f8f8', padding: '14px 18px', borderBottom: `1px solid ${bloque.tipo === 'alerta' ? '#fecaca' : '#f3f4f6'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {bloque.numero && <span style={{ fontSize: 11, fontWeight: 900, color: bloque.tipo === 'banco' ? 'rgba(255,255,255,0.5)' : '#9ca3af' }}>{bloque.numero}</span>}
              {bloque.titulo && <p style={{ fontSize: 14, fontWeight: 800, color: bloque.tipo === 'alerta' ? '#991b1b' : bloque.tipo === 'banco' ? '#fff' : '#1a1a2e', margin: 0 }}>{bloque.titulo}</p>}
            </div>
          </div>
        )}
        <div style={{ padding: '14px 18px', background: bloque.tipo === 'alerta' ? '#fef2f2' : '#fff' }}>
          {bloque.contenido && <p style={{ fontSize: 14, color: bloque.tipo === 'alerta' ? '#7f1d1d' : '#374151', lineHeight: 1.7, margin: bloque.lista || bloque.destacado ? '0 0 12px' : 0 }}>{bloque.contenido}</p>}
          {bloque.lista && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {bloque.lista.map((item, j) => (
                <p key={j} style={{ fontSize: 14, color: '#374151', margin: 0, lineHeight: 1.5 }}>
                  <span style={{ color: colorActivo, fontWeight: 900 }}>✓</span> {item}
                </p>
              ))}
            </div>
          )}
          {bloque.destacado && (
            <div style={{ marginTop: bloque.contenido || bloque.lista ? 12 : 0, background: bloque.tipo === 'banco' ? '#f0fdf4' : bloque.tipo === 'alerta' ? '#fee2e2' : '#f8f8f8', borderRadius: 8, padding: '10px 14px' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: bloque.tipo === 'banco' ? '#065f46' : bloque.tipo === 'alerta' ? '#b91c3c' : '#1a1a2e', margin: 0, whiteSpace: 'pre-line' }}>{bloque.destacado}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Guías · Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: system-ui, sans-serif; background: #f8f8f8; }`}</style>
      </Head>

      <div style={{ minHeight: '100vh', background: '#f8f8f8' }}>

        {/* HEADER */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 20px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 32, objectFit: 'contain' }} />
              <div>
                <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Portal del Asesor</p>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#4a4a4a' }}>Guías y Consultas</h1>
              </div>
            </div>
            <a href="/kpis" style={{ fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>← KPIs</a>
          </div>
        </div>

        {/* TABS */}
        <div style={{ background: '#fff', borderBottom: '1px solid #f3f4f6', padding: '0 20px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 0, overflowX: 'auto' }}>
            {SECCIONES.map(s => (
              <button key={s.id} onClick={() => setSeccionActiva(s.id)}
                style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: seccionActiva === s.id ? s.color : '#9ca3af', background: 'none', border: 'none', borderBottom: `2px solid ${seccionActiva === s.id ? s.color : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* DESCARGAS */}
          {seccionActiva === 'descargas' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 22, fontWeight: 900, color: '#1a1a2e', margin: '0 0 4px' }}>Materiales para prospectos</h2>
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>Descarga y envía directamente por WhatsApp</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {DESCARGAS.map((doc, i) => (
                  <a key={i} href={doc.archivo} download target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                    <div style={{ background: '#fff', border: '1px solid #f3f4f6', borderRadius: 14, padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'}>
                      <div style={{ width: 52, height: 52, borderRadius: 12, background: doc.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                        {doc.emoji}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 15, fontWeight: 800, color: '#1a1a2e', margin: '0 0 4px' }}>{doc.nombre}</p>
                        <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, lineHeight: 1.5 }}>{doc.descripcion}</p>
                      </div>
                      <div style={{ background: doc.color, color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        ↓ PDF
                      </div>
                    </div>
                  </a>
                ))}
              </div>
              <div style={{ marginTop: 20, background: '#f0fdf4', border: '1px solid #6ee7b7', borderRadius: 12, padding: '14px 18px' }}>
                <p style={{ fontSize: 13, color: '#065f46', fontWeight: 700, margin: '0 0 4px' }}>💡 Tip</p>
                <p style={{ fontSize: 13, color: '#064e3b', margin: 0, lineHeight: 1.6 }}>Descarga el archivo y compártelo directamente por WhatsApp. Los brochures son para prospectos; las políticas son para explicar condiciones antes del cierre.</p>
              </div>
            </div>
          )}

          {/* SECCIONES DE CONTENIDO */}
          {seccionActiva !== 'descargas' && seccion && (
            <>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 22, fontWeight: 900, color: '#1a1a2e', margin: '0 0 4px' }}>{seccion.titulo}</h2>
                <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>{seccion.subtitulo}</p>
              </div>
              {seccion.bloques.map((bloque, i) => renderBloque(bloque, i))}
            </>
          )}
        </div>

      </div>
    </>
  )
}
