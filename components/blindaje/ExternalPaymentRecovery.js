import Head from 'next/head'
export default function ExternalPaymentRecovery({ recovery }) {
  return <><Head><meta name="referrer" content="no-referrer" /></Head>
    <main style={{ maxWidth: 560, margin: '48px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      {recovery.error ? <><p role="alert">No pudimos comprobar si tu información ya fue recibida. Reintenta la recuperación antes de enviar un nuevo formulario.</p>
        <button type="button" onClick={recovery.retry} style={{ padding: '12px 18px', border: 0, borderRadius: 10, background: '#b91c3c', color: '#fff', fontWeight: 700 }}>Reintentar recuperación</button></>
        : <p role="status">Comprobando si tu información ya fue recibida…</p>}
    </main></>
}
