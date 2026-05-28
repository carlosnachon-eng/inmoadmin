import { C, st, Badge, fmt, fmtDate } from '../../lib/polizaUtils'

export default function TabCompraventa({ vendedores, compradores, subTab, onSubTab, onSelectVendedor, onSelectComprador, onReload }) {
  const subTabs = [
    { id: 'vendedores', label: `🏠 Vendedores (${vendedores.length})` },
    { id: 'compradores', label: `👤 Compradores (${compradores.length})` },
  ]
  return (
    <div>
      <p style={st.sectionTitle}>Compraventa</p>
      <p style={st.sectionSub}>Vendedores, compradores y expedientes de compraventa</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: `1px solid ${C.border}` }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => onSubTab(t.id)}
            style={{ padding: '10px 18px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: subTab === t.id ? C.gold : 'transparent',
              color: subTab === t.id ? '#000' : C.muted,
              borderBottom: subTab === t.id ? `2px solid ${C.gold}` : '2px solid transparent',
            }}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'vendedores' && (
        vendedores.length === 0 ? (
          <div style={st.emptyState}><p style={{ fontSize: 40 }}>🏠</p><p>Sin vendedores registrados</p></div>
        ) : (
          <div style={st.card}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={st.tableHead}>
                <tr>
                  <th style={st.th}>Propietario</th>
                  <th style={st.th}>Inmueble</th>
                  <th style={st.th}>Precio</th>
                  <th style={st.th}>Gravamen</th>
                  <th style={st.th}>Copropietarios</th>
                  <th style={st.th}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map(v => (
                  <tr key={v.id} onClick={() => onSelectVendedor(v)} style={st.trHover}
                    onMouseEnter={el => el.currentTarget.style.background = '#f9fafb'}
                    onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                    <td style={st.td}>
                      <p style={{ margin: 0, fontWeight: 600, color: C.text }}>{v.nombre_propietario}</p>
                      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{v.telefono_propietario}</p>
                    </td>
                    <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{v.direccion_inmueble}</span></td>
                    <td style={st.td}><span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(v.precio_venta)}</span></td>
                    <td style={st.td}><Badge status={v.libre_gravamen ? 'activo' : 'pendiente'} /></td>
                    <td style={st.td}>{v.tipo_copropiedad && v.tipo_copropiedad !== 'no' ? <Badge status="pendiente" /> : <span style={{ color: C.faint, fontSize: 11 }}>Solo propietario</span>}</td>
                    <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{fmtDate(v.created_at?.split('T')[0])}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {subTab === 'compradores' && (
        compradores.length === 0 ? (
          <div style={st.emptyState}><p style={{ fontSize: 40 }}>👤</p><p>Sin compradores registrados</p></div>
        ) : (
          <div style={st.card}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={st.tableHead}>
                <tr>
                  <th style={st.th}>Comprador</th>
                  <th style={st.th}>Inmueble de interés</th>
                  <th style={st.th}>Precio pactado</th>
                  <th style={st.th}>Forma de pago</th>
                  <th style={st.th}>Cónyuge</th>
                  <th style={st.th}>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {compradores.map(comp => (
                  <tr key={comp.id} onClick={() => onSelectComprador(comp)} style={st.trHover}
                    onMouseEnter={el => el.currentTarget.style.background = '#f9fafb'}
                    onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                    <td style={st.td}>
                      <p style={{ margin: 0, fontWeight: 600, color: C.text }}>{comp.nombre_comprador}</p>
                      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{comp.celular_comprador}</p>
                    </td>
                    <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{comp.inmueble_interes || '—'}</span></td>
                    <td style={st.td}><span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(comp.precio_pactado)}</span></td>
                    <td style={st.td}><span style={{ fontSize: 12, color: C.muted }}>{comp.forma_pago_compra || '—'}</span></td>
                    <td style={st.td}>{comp.tiene_conyuge ? <Badge status="pendiente" /> : <span style={{ color: C.faint, fontSize: 11 }}>No</span>}</td>
                    <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{fmtDate(comp.created_at?.split('T')[0])}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
