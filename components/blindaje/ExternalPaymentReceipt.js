import Head from 'next/head'
import { legacyReceived, receivedFailure } from '../../lib/externalPaymentClient.mjs'
export default function ExternalPaymentReceipt({ result }) {
  return <><Head><title>Información recibida — Emporio Blindaje Legal</title><meta name="referrer" content="no-referrer" /></Head>
    <main style={{ minHeight: '100vh', background: '#f8f8f8', padding: '48px 20px', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
      <section style={{ maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28, color: '#374151', lineHeight: 1.6 }}>
        <p style={{ color: '#b91c3c', fontWeight: 800 }}>EMPORIO BLINDAJE LEGAL</p>
        <h1 style={{ fontSize: 25 }}>Información recibida</h1>
        {result?.folio && <p>Folio: <strong>{result.folio}</strong></p>}
        <p role="status">{result?.legacy ? legacyReceived : receivedFailure}</p>
      </section>
    </main></>
}
