import { useMemo } from 'react'
import { C, st, fmt, fmtDate } from '../../lib/polizaUtils'

const MESES_LABEL = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const KPICard = ({ label, value, sub, sub2, color, bg, border }) => (
  <div style={{ background: bg || '#fff', border: `1px solid ${border || C.border}`, borderRadius: 12, padding: '16px 20px' }}>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
    <p style={{ margin: '6px 0 2px', fontSize: 24, fontWeight: 900, color: color || C.text }}>{value}</p>
    {sub && <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{sub}</p>}
    {sub2 && <p style={{ margin: '2px 0 0', fontSize: 11, color: color || C.muted, fontWeight: 600 }}>{sub2}</p>}
  </div>
)

const MiniBar = ({ value, max, color }) => (
  <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, flex: 1 }}>
    <div style={{ background: color, borderRadius: 4, height: 8, width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, transition: 'width 0.3s' }} />
  </div>
)

export default function TabKpisPoliza({ expedientes, caja }) {
  const hoy = new Date()
  const anioActual = hoy.getFullYear()

  // ── Conteos de status ──────────────────────────────────────────────────────
  const activos    = expedientes.filter(e => e.status === 'activo').length
  const archivados = expedientes.filter(e => e.status === 'archivado').length
  const vencidos   = expedientes.filter(e => e.status === 'vencido').length

  // ── Tasa de renovación ─────────────────────────────────────────────────────
  const renovados  = expedientes.filter(e => e.expediente_anterior_id).length
  const perdidos   = archivados
  const candidatos = renovados + perdidos
  const tasaRenovacion = candidatos > 0 ? Math.round((renovados / candidatos) * 100) : null

  // ── Renta promedio y proyección ────────────────────────────────────────────
  const expedientesConRenta = expedientes.filter(e => e.status === 'activo' && e.renta_mensual > 0)
  const rentaPromedio = expedientesConRenta.length > 0
    ? expedientesConRenta.reduce((a, e) => a + e.renta_mensual, 0) / expedientesConRenta.length
    : 0

  // Ingreso proyectado = suma de renta_mensual de activos (lo que cobra Emporio mensualmente en polizas)
  // La póliza se cobra anualmente, aquí mostramos el equivalente mensual y anual
  const totalRentaCartera  = expedientesConRenta.reduce((a, e) => a + e.renta_mensual, 0)
  const ingresoProyMensual = totalRentaCartera  // volumen de renta mensual que administra Emporio
  const ingresoProyAnual   = totalRentaCartera * 12

  // ── Distribución de rentas por rango ──────────────────────────────────────
  const rangos = [
    { label: 'Menos de $8K',  min: 0,     max: 8000     },
    { label: '$8K – $12K',    min: 8000,  max: 12000    },
    { label: '$12K – $18K',   min: 12000, max: 18000    },
    { label: '$18K – $25K',   min: 18000, max: 25000    },
    { label: 'Más de $25K',   min: 25000, max: Infinity },
  ]
  const distribucionRentas = rangos.map(r => {
    const exps = expedientesConRenta.filter(e => e.renta_mensual >= r.min && e.renta_mensual < r.max)
    return {
      ...r,
      count: exps.length,
      volumenMensual: exps.reduce((a, e) => a + e.renta_mensual, 0),
    }
  })
  const maxCountRango = Math.max(...distribucionRentas.map(r => r.count), 1)

  // ── Movimiento de cartera por mes — usa fecha_inicio ──────────────────────
  const mesesData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1

      // Nuevas: fecha_inicio en ese mes/año, sin renovacion anterior
      const nuevas = expedientes.filter(e => {
        const fecha = e.fecha_inicio || e.created_at
        if (!fecha) return false
        const d = new Date(fecha + (fecha.length === 10 ? 'T12:00:00' : ''))
        return d.getFullYear() === anioActual && d.getMonth() + 1 === mes && !e.expediente_anterior_id
      }).length

      // Renovaciones: fecha_inicio en ese mes/año, con expediente anterior
      const renovaciones = expedientes.filter(e => {
        const fecha = e.fecha_inicio || e.created_at
        if (!fecha) return false
        const d = new Date(fecha + (fecha.length === 10 ? 'T12:00:00' : ''))
        return d.getFullYear() === anioActual && d.getMonth() + 1 === mes && e.expediente_anterior_id
      }).length

      // Perdidas: archivadas en ese mes
      const perdidas = expedientes.filter(e => {
        if (!e.updated_at || e.status !== 'archivado') return false
        const d = new Date(e.updated_at)
        return d.getFullYear() === anioActual && d.getMonth() + 1 === mes
      }).length

      // Renta promedio de expedientes activos con fecha_inicio en ese mes o antes
      const activosAlMes = expedientes.filter(e => {
        if (e.status !== 'activo' || !e.renta_mensual) return false
        const fecha = e.fecha_inicio || e.created_at
        if (!fecha) return false
        const d = new Date(fecha + (fecha.length === 10 ? 'T12:00:00' : ''))
        return d.getFullYear() < anioActual || (d.getFullYear() === anioActual && d.getMonth() + 1 <= mes)
      })
      const rentaPromedioMes = activosAlMes.length > 0
        ? activosAlMes.reduce((a, e) => a + e.renta_mensual, 0) / activosAlMes.length
        : 0

      return { mes, label: MESES_LABEL[mes], nuevas, renovaciones, perdidas, total: nuevas + renovaciones, rentaPromedioMes }
    })
  }, [expedientes, anioActual])

  const maxMes = Math.max(...mesesData.map(m => Math.max(m.total, m.perdidas)), 1)

  // ── Ingresos caja por mes ─────────────────────────────────────────────────
  const cajaPorMes = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1
      const ingresos = caja
        .filter(m => m.tipo === 'ingreso' && m.fecha?.startsWith(`${anioActual}-${String(mes).padStart(2, '0')}`))
        .reduce((a, m) => a + (m.monto || 0), 0)
      const egresos = caja
        .filter(m => m.tipo === 'egreso' && m.fecha?.startsWith(`${anioActual}-${String(mes).padStart(2, '0')}`))
        .reduce((a, m) => a + (m.monto || 0), 0)
      return { mes, label: MESES_LABEL[mes], ingresos, egresos, saldo: ingresos - egresos }
    })
  }, [caja, anioActual])

  const maxCaja = Math.max(...cajaPorMes.map(m => m.ingresos), 1)

  // Top 5 rentas más altas
  const top5Rentas = [...expedientesConRenta]
    .sort((a, b) => b.renta_mensual - a.renta_mensual)
    .slice(0, 5)

  // Renta promedio por mes — solo meses con datos
  const rentaPorMes = mesesData.filter(m => m.rentaPromedioMes > 0)
  const maxRentaMes = Math.max(...rentaPorMes.map(m => m.rentaPromedioMes), 1)

  return (
    <div>
      <p style={st.sectionTitle}>KPIs — Área de Pólizas</p>
      <p style={st.sectionSub}>Indicadores clave de desempeño del área jurídica</p>

      {/* ── Fila 1: KPIs principales ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        <KPICard label="Pólizas activas" value={activos} color={C.greenText} bg={C.greenBg} border="#86efac"
          sub={`${expedientesConRenta.length} con renta registrada`} />
        <KPICard label="Tasa de renovación"
          value={tasaRenovacion !== null ? `${tasaRenovacion}%` : '—'}
          color={tasaRenovacion >= 70 ? C.greenText : tasaRenovacion >= 50 ? '#92400e' : C.redText}
          bg={tasaRenovacion >= 70 ? C.greenBg : tasaRenovacion >= 50 ? '#fffbeb' : '#fee2e2'}
          sub={`${renovados} renov. / ${perdidos} perd.`} />
        <KPICard label="Renta promedio"
          value={fmt(rentaPromedio)}
          color={C.goldText} bg="#fff0f3"
          sub="mensual por expediente"
          sub2={`Anual: ${fmt(rentaPromedio * 12)}`} />
        <KPICard label="Volumen cartera"
          value={fmt(ingresoProyMensual)}
          color={C.blueText} bg={C.blueBg}
          sub="renta mensual total"
          sub2={`Anual: ${fmt(ingresoProyAnual)}`} />
        <KPICard label="Archivados / Perdidos" value={archivados} color={C.muted}
          sub={`${vencidos} vencidos sin archivar`} />
      </div>

      {/* ── Fila 2: Movimiento mensual + Caja ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Movimiento de cartera */}
        <div style={{ ...st.card, padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.text }}>Movimiento de cartera {anioActual}</p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted }}>Nuevas + renovaciones vs perdidas (por fecha de inicio)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mesesData.filter(m => m.total > 0 || m.perdidas > 0).map(m => (
              <div key={m.mes}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text, width: 28 }}>{m.label}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>
                    {m.nuevas > 0 && <span style={{ color: C.greenText, marginRight: 6 }}>+{m.nuevas} nuevas</span>}
                    {m.renovaciones > 0 && <span style={{ color: C.blueText, marginRight: 6 }}>+{m.renovaciones} renov.</span>}
                    {m.perdidas > 0 && <span style={{ color: C.redText }}>-{m.perdidas} perd.</span>}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                    {m.nuevas > 0 && <div style={{ background: C.greenText, borderRadius: 4, height: 8, width: `${(m.nuevas / maxMes) * 100}%` }} />}
                    {m.renovaciones > 0 && <div style={{ background: C.blueText, borderRadius: 4, height: 8, width: `${(m.renovaciones / maxMes) * 100}%` }} />}
                  </div>
                  {m.perdidas > 0 && <div style={{ background: C.redText, borderRadius: 4, height: 8, width: `${(m.perdidas / maxMes) * 100}%`, marginLeft: 4 }} />}
                </div>
              </div>
            ))}
            {mesesData.filter(m => m.total > 0 || m.perdidas > 0).length === 0 && (
              <p style={{ color: C.faint, textAlign: 'center', padding: 20, fontSize: 12 }}>Sin movimientos en {anioActual}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            {[{ color: C.greenText, label: 'Nuevas' }, { color: C.blueText, label: 'Renovaciones' }, { color: C.redText, label: 'Perdidas' }].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                <span style={{ fontSize: 11, color: C.muted }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Caja por mes */}
        <div style={{ ...st.card, padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.text }}>Ingresos caja {anioActual}</p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted }}>Ingresos mensuales del área jurídica</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cajaPorMes.filter(m => m.ingresos > 0 || m.egresos > 0).map(m => (
              <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.text, width: 28 }}>{m.label}</span>
                <MiniBar value={m.ingresos} max={maxCaja} color={C.greenText} />
                <span style={{ fontSize: 11, fontWeight: 700, color: m.saldo >= 0 ? C.greenText : C.redText, width: 80, textAlign: 'right' }}>
                  {fmt(m.ingresos)}
                </span>
              </div>
            ))}
            {cajaPorMes.filter(m => m.ingresos > 0 || m.egresos > 0).length === 0 && (
              <p style={{ color: C.faint, textAlign: 'center', padding: 20, fontSize: 12 }}>Sin movimientos en {anioActual}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Fila 3: Renta promedio por mes ── */}
      {rentaPorMes.length > 0 && (
        <div style={{ ...st.card, padding: 20, marginBottom: 16 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.text }}>Renta promedio mensual {anioActual}</p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted }}>
            Evolución del ticket promedio de renta — indica hacia qué segmento enfocarse comercialmente
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rentaPorMes.map(m => (
              <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.text, width: 28 }}>{m.label}</span>
                <MiniBar value={m.rentaPromedioMes} max={maxRentaMes} color={C.goldText} />
                <span style={{ fontSize: 11, fontWeight: 700, color: C.goldText, width: 90, textAlign: 'right' }}>
                  {fmt(m.rentaPromedioMes)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.muted }}>Promedio actual (cartera activa)</span>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: C.goldText }}>{fmt(rentaPromedio)}</span>
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>mensual</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.goldText, marginLeft: 16 }}>{fmt(rentaPromedio * 12)}</span>
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>anual</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Fila 4: Distribución de rentas + Top 5 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Distribución por rango */}
        <div style={{ ...st.card, padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.text }}>Distribución de rentas</p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted }}>
            Expedientes activos por rango — el rango más grande es donde Emporio debe buscar más
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {distribucionRentas.map(r => (
              <div key={r.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: C.text }}>{r.label}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {r.count} exp. · <span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(r.volumenMensual)}/mes</span>
                  </span>
                </div>
                <MiniBar value={r.count} max={maxCountRango} color={C.goldText} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: C.muted }}>Volumen mensual total cartera</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.goldText }}>{fmt(ingresoProyMensual)}</span>
          </div>
        </div>

        {/* Top 5 rentas más altas */}
        <div style={{ ...st.card, padding: 20 }}>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.text }}>Top 5 rentas más altas</p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: C.muted }}>Expedientes activos con mayor renta mensual</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {top5Rentas.length === 0 && (
              <p style={{ color: C.faint, textAlign: 'center', padding: 20, fontSize: 12 }}>Sin datos</p>
            )}
            {top5Rentas.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: i === 0 ? '#fff0f3' : '#f9fafb', borderRadius: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: i === 0 ? C.goldText : '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: i === 0 ? '#fff' : C.muted, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nombre_arrendatario || '—'}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.direccion_inmueble || '—'}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.goldText }}>{fmt(e.renta_mensual)}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{fmt(e.renta_mensual * 12)}/año</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
