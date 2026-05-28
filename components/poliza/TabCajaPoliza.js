import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, Badge, fmt } from '../../lib/polizaUtils'

export default function TabCajaPoliza({ movimientos, onReload }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ tipo: 'ingreso', concepto: 'pago_poliza', descripcion: '', monto: '', metodo_pago: 'efectivo' })
  const [saving, setSaving] = useState(false)

  const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + (m.monto || 0), 0)
  const egresos  = movimientos.filter(m => m.tipo === 'egreso').reduce((a, m) => a + (m.monto || 0), 0)
  const saldo    = ingresos - egresos

  const CONCEPTOS = {
    investigacion: 'Investigación', anticipo_poliza: 'Anticipo póliza',
    pago_poliza: 'Pago póliza', saldo_poliza: 'Saldo póliza', otro: 'Otro',
  }

  const handleSave = async () => {
    if (!form.monto || !form.descripcion) return
    setSaving(true)
    await supabase.from('poliza_caja').insert({ ...form, monto: parseFloat(form.monto), fecha: new Date().toISOString().split('T')[0] })
    setSaving(false)
    setShowForm(false)
    setForm({ tipo: 'ingreso', concepto: 'pago_poliza', descripcion: '', monto: '', metodo_pago: 'efectivo' })
    onReload()
  }

  return (
    <div>
      <p style={st.sectionTitle}>Caja — Póliza Jurídica</p>
      <p style={st.sectionSub}>Registro de cobros y pagos del área jurídica</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total ingresos', value: fmt(ingresos), color: C.greenText, bg: C.greenBg },
          { label: 'Total egresos', value: fmt(egresos), color: C.redText, bg: C.redBg },
          { label: 'Saldo', value: fmt(saldo), color: saldo >= 0 ? C.greenText : C.redText, bg: saldo >= 0 ? C.greenBg : C.redBg },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 20px' }}>
            <p style={{ margin: 0, fontSize: 11, color: C.muted, textTransform: 'uppercase', fontWeight: 700 }}>{s.label}</p>
            <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={() => setShowForm(!showForm)} style={{ ...st.btn, ...st.btnGold }}>
          {showForm ? 'Cancelar' : '+ Movimiento manual'}
        </button>
      </div>
      {showForm && (
        <div style={{ ...st.card, marginBottom: 20, padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={st.label}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({...f, tipo: e.target.value}))} style={st.input}>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
            <div>
              <label style={st.label}>Concepto</label>
              <select value={form.concepto} onChange={e => setForm(f => ({...f, concepto: e.target.value}))} style={st.input}>
                {Object.entries(CONCEPTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={st.label}>Método de pago</label>
              <select value={form.metodo_pago} onChange={e => setForm(f => ({...f, metodo_pago: e.target.value}))} style={st.input}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={st.label}>Descripción</label>
              <input value={form.descripcion} onChange={e => setForm(f => ({...f, descripcion: e.target.value}))} style={st.input} />
            </div>
            <div>
              <label style={st.label}>Monto</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({...f, monto: e.target.value}))} style={st.input} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        </div>
      )}
      <div style={st.card}>
        {movimientos.length === 0 ? (
          <p style={{ color: C.faint, textAlign: 'center', padding: 32 }}>Sin movimientos registrados</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={st.tableHead}>
              <tr>
                <th style={st.th}>Fecha</th>
                <th style={st.th}>Tipo</th>
                <th style={st.th}>Concepto</th>
                <th style={st.th}>Descripción</th>
                <th style={st.th}>Método</th>
                <th style={st.th}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map(m => (
                <tr key={m.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{m.fecha}</span></td>
                  <td style={st.td}><Badge status={m.tipo === 'ingreso' ? 'activo' : 'rechazado'} /></td>
                  <td style={st.td}><span style={{ fontSize: 12 }}>{CONCEPTOS[m.concepto] || m.concepto}</span></td>
                  <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{m.descripcion}</span></td>
                  <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{m.metodo_pago}</span></td>
                  <td style={st.td}><span style={{ fontWeight: 700, color: m.tipo === 'ingreso' ? C.greenText : C.redText }}>{m.tipo === 'ingreso' ? '+' : '-'}{fmt(m.monto)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
