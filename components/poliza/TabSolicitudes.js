import { C, st, Badge, fmt, fmtDate } from '../../lib/polizaUtils'

export default function TabSolicitudes({ solicitudes, onSelect, onNuevoExp }) {
  if (solicitudes.length === 0) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 40, margin: '0 0 12px' }}>📋</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin solicitudes aún</p>
      <div style={{ marginTop: 16, background: '#f3f4f6', borderRadius: 8, padding: '10px 18px', display: 'inline-block' }}>
        <code style={{ color: '#b91c3c', fontSize: 13 }}>app.emporioinmobiliario.com.mx/solicitud-inquilino</code>
      </div>
    </div>
  )

  return (
    <div>
      <p style={st.sectionTitle}>Solicitudes de investigación</p>
      <p style={st.sectionSub}>Solicitudes enviadas por inquilinos interesados</p>
      <div style={st.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={st.tableHead}>
            <tr>
              <th style={st.th}>Solicitante</th>
              <th style={st.th}>Inmueble de interés</th>
              <th style={st.th}>Ingresos</th>
              <th style={st.th}>Fecha</th>
              <th style={st.th}>Status</th>
              <th style={st.th}></th>
            </tr>
          </thead>
          <tbody>
            {solicitudes.map(sol => (
              <tr key={sol.id} style={st.trHover}
                onMouseEnter={el => el.currentTarget.style.background = '#f9fafb'}
                onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                <td style={st.td} onClick={() => onSelect(sol)}>
                  <p style={{ margin: 0, fontWeight: 600, color: C.text }}>{sol.nombre_completo || sol.razon_social || '—'}</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{sol.telefono}</p>
                </td>
                <td style={st.td} onClick={() => onSelect(sol)}><span style={{ fontSize: 12, color: C.muted }}>{sol.inmueble_interes || '—'}</span></td>
                <td style={st.td} onClick={() => onSelect(sol)}><span style={{ color: C.goldText }}>{fmt(sol.ingresos_mensuales || sol.ingresos_empresa)}</span></td>
                <td style={st.td} onClick={() => onSelect(sol)}><span style={{ fontSize: 11, color: C.muted }}>{fmtDate(sol.created_at?.split('T')[0])}</span></td>
                <td style={st.td} onClick={() => onSelect(sol)}><Badge status={sol.status} /></td>
                <td style={st.td}>
                  {sol.status === 'aprobado' && (
                    <button onClick={() => onNuevoExp(sol)} style={{ ...st.btn, ...st.btnGold, padding: '6px 12px', fontSize: 11 }}>
                      + Expediente
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
