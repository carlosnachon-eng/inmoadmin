import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, fmt } from '../../lib/polizaUtils'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const CONCEPTOS = {
  investigacion: 'Investigación', anticipo_poliza: 'Anticipo póliza',
  pago_poliza: 'Pago póliza', saldo_poliza: 'Saldo póliza', otro: 'Otro',
}

const emptyForm = () => ({
  tipo: 'ingreso', concepto: 'pago_poliza', descripcion: '', monto: '',
  metodo_pago: 'efectivo', fecha: new Date().toISOString().split('T')[0]
})

export default function TabCajaPoliza({ movimientos, onReload }) {
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const now = new Date()
  const [filtroAnio, setFiltroAnio] = useState(now.getFullYear())
  const [filtroMes, setFiltroMes] = useState(now.getMonth() + 1)

  const aniosDisponibles = [...new Set(movimientos.map(m => m.fecha?.slice(0, 4)).filter(Boolean))].sort((a, b) => b - a)
  if (!aniosDisponibles.includes(String(now.getFullYear()))) aniosDisponibles.unshift(String(now.getFullYear()))

  const movimientosFiltrados = movimientos.filter(m => {
    if (!m.fecha) return false
    const [anio, mes] = m.fecha.split('-').map(Number)
    if (anio !== filtroAnio) return false
    if (filtroMes !== 0 && mes !== filtroMes) return false
    return true
  })

  const ingresos = movimientosFiltrados.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + (m.monto || 0), 0)
  const egresos  = movimientosFiltrados.filter(m => m.tipo === 'egreso').reduce((a, m) => a + (m.monto || 0), 0)
  const saldo    = ingresos - egresos

  // Totales globales (sin filtro)
  const ingresosTotal = movimientos.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + (m.monto || 0), 0)
  const egresosTotal  = movimientos.filter(m => m.tipo === 'egreso').reduce((a, m) => a + (m.monto || 0), 0)
  const saldoTotal    = ingresosTotal - egresosTotal

  const openNew = () => {
    setEditando(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  const openEdit = (m) => {
    setEditando(m.id)
    setForm({
      tipo: m.tipo, concepto: m.concepto, descripcion: m.descripcion,
      monto: String(m.monto), metodo_pago: m.metodo_pago, fecha: m.fecha,
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditando(null)
    setForm(emptyForm())
  }

  const handleSave = async () => {
    if (!form.monto || !form.descripcion || !form.fecha) return
    setSaving(true)
    const payload = { ...form, monto: parseFloat(form.monto) }
    if (editando) {
      await supabase.from('poliza_caja').update(payload).eq('id', editando)
    } else {
      await supabase.from('poliza_caja').insert(payload)
    }
    setSaving(false)
    cancelForm()
    onReload()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este movimiento?')) return
    await supabase.from('poliza_caja').delete().eq('id', id)
    onReload()
  }

  return (
    <div>
      <p style={st.sectionTitle}>Caja — Póliza Jurídica</p>
      <p style={st.sectionSub}>Registro de cobros y pagos del área jurídica</p>

      {/* Totales globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Ingresos totales', value: fmt(ingresosTotal), color: C.greenText, bg: C.greenBg },
          { label: 'Egresos totales', value: fmt(egresosTotal), color: C.redText, bg: C.redBg },
          { label: 'Saldo total', value: fmt(saldoTotal), color: saldoTotal >= 0 ? C.greenText : C.redText, bg: saldoTotal >= 0 ? C.greenBg : C.redBg },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: C.muted, textTransform: 'uppercase', fontWeight: 700 }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filtroAnio} onChange={e => setFiltroAnio(parseInt(e.target.value))}
          style={{ ...st.input, width: 'auto', fontWeight: 700 }}>
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filtroMes} onChange={e => setFiltroMes(parseInt(e.target.value))}
          style={{ ...st.input, width: 'auto' }}>
          <option value={0}>Todos los meses</option>
          {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        {filtroMes !== 0 && (
          <button onClick={() => setFiltroMes(0)}
            style={{ ...st.btn, background: '#f3f4f6', color: '#6b7280', fontSize: 12 }}>
            Limpiar
          </button>
        )}
        <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
          {movimientosFiltrados.length} movimiento{movimientosFiltrados.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Totales */}
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

      {/* Botón nuevo */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={showForm && !editando ? cancelForm : openNew}
          style={{ ...st.btn, ...st.btnGold }}>
          {showForm && !editando ? 'Cancelar' : '+ Movimiento manual'}
        </button>
      </div>

      {/* Formulario nuevo / edición */}
      {showForm && (
        <div style={{ ...st.card, marginBottom: 20, padding: 16, border: editando ? '2px solid #3b82f6' : undefined }}>
          <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: editando ? '#1e40af' : C.text }}>
            {editando ? '✏️ Editar movimiento' : 'Nuevo movimiento'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={st.label}>Fecha</label>
              <input type="date" value={form.fecha}
                onChange={e => setForm(f => ({...f, fecha: e.target.value}))} style={st.input} />
            </div>
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
              <input value={form.descripcion}
                onChange={e => setForm(f => ({...f, descripcion: e.target.value}))} style={st.input} />
            </div>
            <div>
              <label style={st.label}>Monto</label>
              <input type="number" value={form.monto}
                onChange={e => setForm(f => ({...f, monto: e.target.value}))} style={st.input} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={cancelForm}
              style={{ ...st.btn, background: '#f3f4f6', color: '#6b7280' }}>
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ ...st.btn, ...st.btnGold, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Guardando...' : editando ? 'Guardar cambios' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div style={st.card}>
        {movimientosFiltrados.length === 0 ? (
          <p style={{ color: C.faint, textAlign: 'center', padding: 32 }}>Sin movimientos para este periodo</p>
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
                <th style={st.th}></th>
              </tr>
            </thead>
            <tbody>
              {movimientosFiltrados.map(m => (
                <tr key={m.id} style={{ borderTop: `1px solid ${C.border}`, background: editando === m.id ? '#eff6ff' : 'transparent' }}>
                  <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{m.fecha}</span></td>
                  <td style={st.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                      background: m.tipo === 'ingreso' ? C.greenBg : C.redBg,
                      color: m.tipo === 'ingreso' ? C.greenText : C.redText,
                    }}>
                      {m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
                    </span>
                  </td>
                  <td style={st.td}><span style={{ fontSize: 12 }}>{CONCEPTOS[m.concepto] || m.concepto}</span></td>
                  <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{m.descripcion}</span></td>
                  <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{m.metodo_pago}</span></td>
                  <td style={st.td}>
                    <span style={{ fontWeight: 700, color: m.tipo === 'ingreso' ? C.greenText : C.redText }}>
                      {m.tipo === 'ingreso' ? '+' : '-'}{fmt(m.monto)}
                    </span>
                  </td>
                  <td style={st.td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => openEdit(m)}
                        style={{ ...st.btn, padding: '4px 10px', fontSize: 11, background: '#f3f4f6', color: '#374151' }}>
                        Editar
                      </button>
                      <button onClick={() => handleDelete(m.id)}
                        style={{ ...st.btn, padding: '4px 8px', fontSize: 11, background: '#fee2e2', color: '#991b1b' }}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
