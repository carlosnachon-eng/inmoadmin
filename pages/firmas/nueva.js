import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'

export default function NuevaFirma() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    tipo: 'arrendamiento',
    es_contado: false,
    titulo: '',
    direccion: '',
    nombre_comprador: '',
    nombre_vendedor: '',
    monto_apartado: '',
    forma_pago: 'transferencia',
    modalidad_firma: 'presencial',
    urgente: false,
  })

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const res = await fetch('/api/firmas/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          monto_apartado: form.monto_apartado ? parseFloat(form.monto_apartado) : null,
          fecha_apartado: new Date().toISOString().split('T')[0],
          creado_por: user.id,
          creado_por_nombre: user.email,
        })
      })
      const data = await res.json()
      if (data.firma) {
        router.push(`/firmas/${data.firma.id}`)
      } else {
        console.error('Error:', data)
        setLoading(false)
      }
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const esCV = form.tipo === 'compraventa'
  const card = { background: '#fff', borderRadius: '8px', padding: '1.25rem', boxShadow: '0 1px 6px rgba(0,0,0,0.08)', marginBottom: '1rem' }
  const labelStyle = { display: 'block', fontSize: '0.82rem', marginBottom: '4px', color: '#555' }
  const inputStyle = { width: '100%', padding: '0.6rem', marginBottom: '1rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box' }

  return (
    <div style={{ maxWidth: '620px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
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

      <form onSubmit={handleSubmit}>
        <div style={card}>
          <label style={labelStyle}>Tipo de operacion</label>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            {['arrendamiento', 'compraventa'].map(t => (
              <button type="button" key={t} onClick={() => set('tipo', t)} style={{
                flex: 1, padding: '0.6rem', border: '2px solid',
                borderColor: form.tipo === t ? '#1a3c5e' : '#ddd',
                borderRadius: '6px', background: form.tipo === t ? '#1a3c5e' : '#fff',
                color: form.tipo === t ? '#fff' : '#333',
                cursor: 'pointer', fontWeight: 600, textTransform: 'capitalize'
              }}>{t}</button>
            ))}
          </div>
          {esCV && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="contado" checked={form.es_contado} onChange={e => set('es_contado', e.target.checked)} />
              <label htmlFor="contado" style={{ fontSize: '0.9rem', color: '#555' }}>Operacion de contado (omite credito, avaluo e INFONAVIT)</label>
            </div>
          )}
        </div>

        <div style={card}>
          <h3 style={{ fontSize: '0.95rem', color: '#1a3c5e', marginTop: 0, marginBottom: '1rem' }}>Datos generales</h3>
          <label style={labelStyle}>Titulo del expediente</label>
          <input value={form.titulo} onChange={e => set('titulo', e.target.value)}
            placeholder={esCV ? 'Compraventa Casa Narvarte - Juan Garcia' : 'Renta Depto Roma - Ana Lopez'}
            required style={inputStyle} />
          <label style={labelStyle}>Direccion del inmueble</label>
          <input value={form.direccion} onChange={e => set('direccion', e.target.value)}
            placeholder="Calle, numero, colonia, ciudad" style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{esCV ? 'Nombre del comprador' : 'Nombre del inquilino'}</label>
              <input value={form.nombre_comprador} onChange={e => set('nombre_comprador', e.target.value)} required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Nombre del propietario</label>
              <input value={form.nombre_vendedor} onChange={e => set('nombre_vendedor', e.target.value)} required style={inputStyle} />
            </div>
          </div>
        </div>

        <div style={card}>
          <h3 style={{ fontSize: '0.95rem', color: '#1a3c5e', marginTop: 0, marginBottom: '1rem' }}>Coordinacion</h3>
          {esCV && (
            <>
              <label style={labelStyle}>Monto de apartado</label>
              <input type="number" value={form.monto_apartado} onChange={e => set('monto_apartado', e.target.value)} placeholder="10000" style={inputStyle} />
            </>
          )}
          <label style={labelStyle}>Forma de pago del cliente (apartado)</label>
          <select value={form.forma_pago} onChange={e => set('forma_pago', e.target.value)} style={inputStyle}>
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
          </select>
          <label style={labelStyle}>Modalidad de firma</label>
          <select value={form.modalidad_firma} onChange={e => set('modalidad_firma', e.target.value)} style={inputStyle}>
            <option value="presencial">Presencial</option>
            <option value="digital">Digital</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input type="checkbox" id="urgente" checked={form.urgente} onChange={e => set('urgente', e.target.checked)} />
            <label htmlFor="urgente" style={{ fontSize: '0.9rem', color: '#555' }}>Urgente (3 dias)</label>
          </div>
        </div>

        <button type="submit" disabled={loading} style={{ width: '100%', padding: '1rem', background: '#1a3c5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}>
          {loading ? 'Creando expediente...' : 'Crear expediente'}
        </button>
      </form>
      </div>
    </div>
  )
}
