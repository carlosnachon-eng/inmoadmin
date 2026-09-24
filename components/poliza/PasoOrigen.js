import { useState } from 'react'
import Head from 'next/head'

export default function PasoOrigen({ tipo, onContinue }) {
  const [origen, setOrigen] = useState('')
  const [asesor, setAsesor] = useState('')
  const [noRecuerdo, setNoRecuerdo] = useState(false)
  const propietario = tipo === 'propietario'
  const puedeContinuar = origen === 'b2c' || (origen === 'emporio' && (noRecuerdo || asesor.trim()))
  return (
    <main style={{ minHeight: '100vh', background: '#f8f8f8', padding: '32px 16px', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }}>
      <Head><title>Antes de comenzar — Emporio Blindaje Legal</title></Head>
      <form onSubmit={event => {
        event.preventDefault()
        if (puedeContinuar) onContinue({ origen_operacion: origen, asesor_referencia: origen === 'emporio' && !noRecuerdo ? asesor.trim() : null })
      }} style={{ maxWidth: 580, margin: '0 auto', padding: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, color: '#374151' }}>
        <p style={{ color: '#b91c3c', fontWeight: 700 }}>Emporio Blindaje Legal · Paso 0</p>
        <h1 style={{ fontSize: 24 }}>Antes de comenzar, cuéntanos sobre esta operación</h1>
        <fieldset style={{ border: 0, padding: 0, margin: '24px 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: 16 }}>{propietario
            ? '¿Esta propiedad está siendo comercializada por Emporio Inmobiliario?'
            : '¿Esta renta corresponde a una propiedad que conociste por medio de Emporio Inmobiliario?'}</legend>
          {[
            ['emporio', propietario ? 'Sí' : 'Sí, la vi con Emporio Inmobiliario'],
            ['b2c', propietario ? 'No, solamente necesito Blindaje Legal' : 'No, ya tengo la propiedad y sólo necesito Blindaje Legal'],
          ].map(([value, label]) => (
            <label key={value} style={{ display: 'flex', gap: 10, padding: '12px 0', cursor: 'pointer' }}>
              <input type="radio" name="origen" value={value} checked={origen === value} required onChange={() => setOrigen(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {origen === 'emporio' && <div style={{ marginBottom: 24 }}>
          <label htmlFor="asesor-referencia" style={{ display: 'block', fontWeight: 600, marginBottom: 10 }}>¿Quién fue tu asesor inmobiliario?</label>
          <input id="asesor-referencia" value={asesor} disabled={noRecuerdo} required={!noRecuerdo} onChange={event => setAsesor(event.target.value)} placeholder="Nombre o referencia del asesor" style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid #9ca3af', borderRadius: 8 }} />
          <label style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <input type="checkbox" checked={noRecuerdo} onChange={event => setNoRecuerdo(event.target.checked)} />No recuerdo
          </label>
        </div>}
        <button type="submit" disabled={!puedeContinuar} style={{ background: puedeContinuar ? '#b91c3c' : '#e5e7eb', color: puedeContinuar ? '#fff' : '#374151', border: 0, borderRadius: 8, padding: '12px 24px', fontWeight: 700, cursor: puedeContinuar ? 'pointer' : 'default' }}>Continuar</button>
      </form>
    </main>
  )
}
