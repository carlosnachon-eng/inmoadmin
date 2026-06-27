import Link from 'next/link'

export default function NuevaFirma() {
  return (
    <div style={{ maxWidth: '620px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: '3px solid #C8102E', padding: '0 24px', height: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 32, background: '#e5e7eb' }} />
          <div>
            <p style={{ margin: 0, fontSize: 9, color: '#C8102E', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Área Jurídica</p>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1a1a2e' }}>Nuevo expediente de firma</h1>
          </div>
        </div>
        <Link href="/firmas" style={{ fontSize: '0.85rem', color: '#9ca3af', textDecoration: 'none', fontWeight: 600 }}>← Volver</Link>
      </div>

      <div style={{ padding: '0 1rem' }}>
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 6px', color: '#9a3412', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flujo operativo vigente</p>
          <h2 style={{ margin: '0 0 8px', color: '#1a3c5e', fontSize: '1.25rem' }}>Las firmas se crean desde recibos</h2>
          <p style={{ margin: 0, color: '#555', fontSize: '0.93rem', lineHeight: 1.45 }}>
            Para mantener trazabilidad entre apartado, propiedad, recibo y expediente, ya no se crean firmas manuales desde esta pantalla.
            Primero registra o abre el recibo de apartado y desde ahí inicia el flujo de Firmas.
          </p>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <Link href="/recibos/nuevo" style={{ background: '#C8102E', color: '#fff', padding: '0.9rem 1rem', borderRadius: 10, textDecoration: 'none', fontSize: '0.95rem', fontWeight: 800, textAlign: 'center' }}>
            Crear recibo de apartado
          </Link>
          <Link href="/recibos" style={{ background: '#1a3c5e', color: '#fff', padding: '0.9rem 1rem', borderRadius: 10, textDecoration: 'none', fontSize: '0.95rem', fontWeight: 800, textAlign: 'center' }}>
            Ver recibos existentes
          </Link>
        </div>
      </div>
    </div>
  )
}
