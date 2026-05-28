import { C, st, Badge, fmt, fmtDate } from '../../lib/polizaUtils'

export default function TabPropietarios({ propietarios, onSelect }) {
  if (propietarios.length === 0) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 40, margin: '0 0 12px' }}>🏠</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin propietarios registrados</p>
      <p>Comparte el link de registro con los propietarios</p>
      <div style={{ marginTop: 16, background: '#f3f4f6', borderRadius: 8, padding: '10px 18px', display: 'inline-block' }}>
        <code style={{ color: '#b91c3c', fontSize: 13 }}>app.emporioinmobiliario.com.mx/registro-propietario</code>
      </div>
    </div>
  )

  return (
    <div>
      <p style={st.sectionTitle}>Propietarios e inmuebles</p>
      <p style={st.sectionSub}>Registros enviados por los propietarios</p>
      <div style={st.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={st.tableHead}>
            <tr>
              <th style={st.th}>Propietario</th>
              <th style={st.th}>Inmueble</th>
              <th style={st.th}>Renta</th>
              <th style={st.th}>Tipo</th>
              <th style={st.th}>Fecha</th>
              <th style={st.th}>Admin</th>
            </tr>
          </thead>
          <tbody>
            {propietarios.map(p => (
              <tr key={p.id} onClick={() => onSelect(p)}
                style={st.trHover}
                onMouseEnter={el => el.currentTarget.style.background = '#f9fafb'}
                onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                <td style={st.td}>
                  <p style={{ margin: 0, fontWeight: 600, color: C.text }}>{p.nombre_propietario}</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{p.telefono_propietario}</p>
                </td>
                <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{p.direccion_inmueble}</span></td>
                <td style={st.td}><span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(p.monto_renta)}</span></td>
                <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{p.tipo_inmueble?.replace(/_/g, ' ') || '—'}</span></td>
                <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{fmtDate(p.created_at?.split('T')[0])}</span></td>
                <td style={st.td}>{p.contrato_administracion ? <Badge status="activo" /> : <span style={{ color: C.faint, fontSize: 11 }}>Solo renta</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
