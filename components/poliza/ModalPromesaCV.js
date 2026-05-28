import React from 'react'

export default function ModalPromesaCV({ vendedor: v, compradores = [], onClose, onGenerar }) {
  const fmt = (n) => n ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : ''

  const [form, setForm] = React.useState({
    curp_vendedor: '', credencial_vendedor: '',
    nombre_comprador: '', domicilio_comprador: '', curp_comprador: '', rfc_comprador: '', credencial_comprador: '',
    superficie: '',
    volumen_escritura: '', instrumento_escritura: '', fecha_escritura: '', notario: '', notaria: '', cuenta_predial: '',
    precio_total_letras: '',
    tipo_credito: 'contado', nombre_banco: '',
    pago1_monto: '', pago1_letras: '', pago1_fecha: new Date().toISOString().split('T')[0],
    tiene_pago2: false, pago2_monto: '', pago2_letras: '', pago2_fecha: '',
    pago3_monto: '', pago3_letras: '', pago3_fecha: '',
    pena_convencional: '100000', pena_letras: 'CIEN MIL PESOS 00/100 M.N.',
    fecha_firma: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
  })

  const set = (k, val) => setForm(p => ({ ...p, [k]: val }))
  const seleccionarComprador = (id) => {
    const c = compradores.find(x => x.id === id)
    if (!c) return
    set('nombre_comprador', c.nombre_comprador || '')
    set('domicilio_comprador', c.domicilio_comprador || '')
    set('curp_comprador', c.curp_comprador || '')
    set('rfc_comprador', c.rfc_comprador || '')
    set('credencial_comprador', c.folio_identificacion_comprador || '')
  }

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#ffffff', color: '#374151', fontSize: 13, boxSizing: 'border-box', fontFamily: 'system-ui' }
  const lbl = { display: 'block', fontSize: 11, color: '#9ca3af', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }
  const fld = { marginBottom: 12 }
  const sec = { color: '#b91c3c', fontWeight: 700, fontSize: 13, margin: '20px 0 10px', borderBottom: '1px solid #e5e7eb', paddingBottom: 6 }
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', padding: 28, color: '#374151' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#374151' }}>Promesa de Compraventa</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9ca3af' }}>{v.nombre_propietario} · {v.direccion_inmueble}</p>
          </div>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', color: '#374151', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        <div style={{ background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 12, color: '#b91c3c' }}>Precio: <strong>{fmt(v.precio_venta)}</strong> · Gravamen: <strong>{v.libre_gravamen ? 'Libre' : (v.institucion_gravamen || 'Con hipoteca')}</strong></p>
        </div>

        {compradores.length > 0 && (
          <div style={fld}>
            <label style={lbl}>Seleccionar comprador registrado</label>
            <select style={{...inp, color: '#fff'}} onChange={e => seleccionarComprador(e.target.value)} defaultValue="">
              <option value="">-- Selecciona un comprador --</option>
              {compradores.map(c => (
                <option key={c.id} value={c.id}>{c.nombre_comprador} · {c.celular_comprador}</option>
              ))}
            </select>
          </div>
        )}

        <p style={sec}>📋 Datos adicionales del vendedor</p>
        <div style={grid2}>
          <div style={fld}><label style={lbl}>CURP del vendedor</label><input style={inp} value={form.curp_vendedor} onChange={e => set('curp_vendedor', e.target.value)} placeholder="XXXX000000XXXXXX" /></div>
          <div style={fld}><label style={lbl}>No. Credencial INE</label><input style={inp} value={form.credencial_vendedor} onChange={e => set('credencial_vendedor', e.target.value)} placeholder="Número de folio" /></div>
        </div>

        <p style={sec}>👤 Datos del comprador</p>
        <div style={fld}><label style={lbl}>Nombre completo *</label><input style={inp} value={form.nombre_comprador} onChange={e => set('nombre_comprador', e.target.value)} /></div>
        <div style={fld}><label style={lbl}>Domicilio</label><input style={inp} value={form.domicilio_comprador} onChange={e => set('domicilio_comprador', e.target.value)} /></div>
        <div style={grid2}>
          <div style={fld}><label style={lbl}>CURP</label><input style={inp} value={form.curp_comprador} onChange={e => set('curp_comprador', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>RFC</label><input style={inp} value={form.rfc_comprador} onChange={e => set('rfc_comprador', e.target.value)} /></div>
        </div>
        <div style={fld}><label style={lbl}>No. Credencial INE</label><input style={inp} value={form.credencial_comprador} onChange={e => set('credencial_comprador', e.target.value)} /></div>

        <p style={sec}>🏠 Antecedentes del inmueble</p>
        <div style={fld}><label style={lbl}>Superficie</label><input style={inp} value={form.superficie} onChange={e => set('superficie', e.target.value)} /></div>
        <div style={grid2}>
          <div style={fld}><label style={lbl}>Volumen de escritura</label><input style={inp} value={form.volumen_escritura} onChange={e => set('volumen_escritura', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>Instrumento No.</label><input style={inp} value={form.instrumento_escritura} onChange={e => set('instrumento_escritura', e.target.value)} /></div>
        </div>
        <div style={grid2}>
          <div style={fld}><label style={lbl}>Fecha de escritura</label><input style={inp} value={form.fecha_escritura} onChange={e => set('fecha_escritura', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>Cuenta predial</label><input style={inp} value={form.cuenta_predial} onChange={e => set('cuenta_predial', e.target.value)} /></div>
        </div>
        <div style={fld}><label style={lbl}>Notario</label><input style={inp} value={form.notario} onChange={e => set('notario', e.target.value)} /></div>
        <div style={fld}><label style={lbl}>Notaría</label><input style={inp} value={form.notaria} onChange={e => set('notaria', e.target.value)} /></div>

        <p style={sec}>💰 Operación y pagos</p>
        <div style={fld}><label style={lbl}>Precio total en letras</label><input style={inp} value={form.precio_total_letras} onChange={e => set('precio_total_letras', e.target.value)} /></div>

        <div style={fld}>
          <label style={lbl}>Forma de pago del resto</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ v: 'contado', l: 'Contado' }, { v: 'infonavit', l: 'INFONAVIT' }, { v: 'bancario', l: 'Crédito bancario' }].map(op => (
              <button key={op.v} onClick={() => set('tipo_credito', op.v)}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: `1px solid ${form.tipo_credito === op.v ? '#c8a96e' : '#333'}`, background: form.tipo_credito === op.v ? '#fff0f3' : '#f9fafb', color: form.tipo_credito === op.v ? '#b91c3c' : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {op.l}
              </button>
            ))}
          </div>
        </div>
        {form.tipo_credito === 'bancario' && (
          <div style={fld}><label style={lbl}>Nombre del banco</label><input style={inp} value={form.nombre_banco} onChange={e => set('nombre_banco', e.target.value)} /></div>
        )}

        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#b91c3c' }}>Pago 1 — Anticipo/Garantía</p>
          <div style={grid2}>
            <div style={fld}><label style={lbl}>Monto $</label><input style={inp} type="number" value={form.pago1_monto} onChange={e => set('pago1_monto', e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Fecha</label><input style={inp} type="date" value={form.pago1_fecha} onChange={e => set('pago1_fecha', e.target.value)} /></div>
          </div>
          <div style={fld}><label style={lbl}>Monto en letras</label><input style={inp} value={form.pago1_letras} onChange={e => set('pago1_letras', e.target.value)} /></div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <button onClick={() => set('tiene_pago2', !form.tiene_pago2)}
            style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 8, color: '#9ca3af', padding: '8px 14px', cursor: 'pointer', fontSize: 12, width: '100%' }}>
            {form.tiene_pago2 ? '✕ Quitar segundo pago' : '+ Agregar segundo pago en efectivo'}
          </button>
        </div>
        {form.tiene_pago2 && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10 }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#b91c3c' }}>Pago 2</p>
            <div style={grid2}>
              <div style={fld}><label style={lbl}>Monto $</label><input style={inp} type="number" value={form.pago2_monto} onChange={e => set('pago2_monto', e.target.value)} /></div>
              <div style={fld}><label style={lbl}>Fecha</label><input style={inp} type="date" value={form.pago2_fecha} onChange={e => set('pago2_fecha', e.target.value)} /></div>
            </div>
            <div style={fld}><label style={lbl}>Monto en letras</label><input style={inp} value={form.pago2_letras} onChange={e => set('pago2_letras', e.target.value)} /></div>
          </div>
        )}

        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#c8a96e' }}>Pago 3 — Resto</p>
          <div style={grid2}>
            <div style={fld}><label style={lbl}>Monto $</label><input style={inp} type="number" value={form.pago3_monto} onChange={e => set('pago3_monto', e.target.value)} /></div>
            <div style={fld}><label style={lbl}>Fecha límite</label><input style={inp} type="date" value={form.pago3_fecha} onChange={e => set('pago3_fecha', e.target.value)} /></div>
          </div>
          <div style={fld}><label style={lbl}>Monto en letras</label><input style={inp} value={form.pago3_letras} onChange={e => set('pago3_letras', e.target.value)} /></div>
        </div>

        <p style={sec}>⚖️ Pena convencional</p>
        <div style={grid2}>
          <div style={fld}><label style={lbl}>Monto $</label><input style={inp} type="number" value={form.pena_convencional} onChange={e => set('pena_convencional', e.target.value)} /></div>
          <div style={fld}><label style={lbl}>En letras</label><input style={inp} value={form.pena_letras} onChange={e => set('pena_letras', e.target.value)} /></div>
        </div>

        <p style={sec}>📅 Fecha de firma</p>
        <div style={fld}><label style={lbl}>Fecha (texto)</label><input style={inp} value={form.fecha_firma} onChange={e => set('fecha_firma', e.target.value)} /></div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#9ca3af', borderRadius: 10, padding: '11px 20px', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
          <button onClick={() => {
            if (!form.nombre_comprador) { alert('El nombre del comprador es requerido'); return }
            if (!form.pago1_monto) { alert('El anticipo es requerido'); return }
            if (!form.pago3_monto) { alert('El resto del precio es requerido'); return }
            onGenerar(form)
          }} style={{ background: '#b91c3c', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
            🖹 Generar Promesa
          </button>
        </div>
      </div>
    </div>
  )
}
