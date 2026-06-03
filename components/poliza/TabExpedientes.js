import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C, st, Badge, fmt, fmtDate } from '../../lib/polizaUtils'

export default function TabExpedientes({ expedientes, propietarios, solicitudes, onSelect, onReload, onRenovar }) {
  const [enviando, setEnviando] = useState(null)

  const hoy = new Date()
  const proximasRenovaciones = expedientes
    .filter(e => {
      if (!e.fecha_vigencia) return false
      // Excluir si ya tiene una renovación activa
      const tieneRenovacion = expedientes.some(r => r.expediente_anterior_id === e.id && r.status === 'activo')
      if (tieneRenovacion) return false
      const vigencia = new Date(e.fecha_vigencia + 'T12:00:00')
      const diasRestantes = Math.ceil((vigencia - hoy) / (1000 * 60 * 60 * 24))
      return diasRestantes <= 60 && diasRestantes >= -30
    })
    .map(e => {
      const vigencia = new Date(e.fecha_vigencia + 'T12:00:00')
      const diasRestantes = Math.ceil((vigencia - hoy) / (1000 * 60 * 60 * 24))
      return { ...e, diasRestantes }
    })
    .sort((a, b) => a.diasRestantes - b.diasRestantes)

  const enviarRecordatorio = async (e) => {
    setEnviando(e.id)
    try {
      const { error } = await supabase.functions.invoke('recordatorio-renovacion', {
        body: {
          expediente_id: e.id,
          nombre_arrendatario: e.nombre_arrendatario,
          nombre_arrendador: e.nombre_arrendador,
          correo_arrendatario: e.correo_arrendatario,
          correo_arrendador: e.correo_arrendador,
          direccion_inmueble: e.direccion_inmueble,
          fecha_vigencia: e.fecha_vigencia,
          dias_restantes: e.diasRestantes,
          renta_mensual: e.renta_mensual,
        }
      })
      if (error) throw error
      await supabase.from('poliza_expedientes').update({
        fecha_ultimo_recordatorio: new Date().toISOString(),
        recordatorio_60_enviado: e.diasRestantes <= 60,
        recordatorio_30_enviado: e.diasRestantes <= 30,
      }).eq('id', e.id)
      onReload()
      alert('✅ Recordatorio enviado correctamente')
    } catch (err) {
      alert('Error enviando recordatorio: ' + err.message)
    } finally {
      setEnviando(null)
    }
  }

  if (expedientes.length === 0) return (
    <div style={st.emptyState}>
      <p style={{ fontSize: 40, margin: '0 0 12px' }}>📁</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Sin expedientes aún</p>
      <p>Crea el primer expediente con el botón de arriba</p>
    </div>
  )

  return (
    <div>
      {proximasRenovaciones.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <p style={{ ...st.sectionTitle, color: C.goldText, marginBottom: 4 }}>⏰ Próximas renovaciones</p>
          <p style={{ ...st.sectionSub, marginBottom: 16 }}>Contratos que vencen en los próximos 60 días o vencidos recientemente</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {proximasRenovaciones.map(e => {
              const vencido = e.diasRestantes < 0
              const urgente = e.diasRestantes <= 30 && e.diasRestantes >= 0
              const bg = vencido ? C.redBg : urgente ? '#fff7ed' : C.goldLight
              const borderColor = vencido ? '#fca5a5' : urgente ? '#fed7aa' : '#fecdd3'
              const color = vencido ? C.redText : urgente ? '#c2410c' : C.goldText
              const yaEnvio = e.fecha_ultimo_recordatorio
                ? new Date(e.fecha_ultimo_recordatorio) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                : false

              return (
                <div key={e.id}
                  style={{ background: bg, border: `1px solid ${borderColor}`, borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => onSelect(e)}>
                    <p style={{ margin: 0, fontWeight: 700, color: C.text, fontSize: 14 }}>{e.nombre_arrendatario}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{e.direccion_inmueble}</p>
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: C.muted }}>
                      Arrendador: {e.nombre_arrendador || '—'} · Renta: {fmt(e.renta_mensual)}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 160 }}>
                    <p style={{ margin: 0, fontWeight: 800, color, fontSize: 13 }}>
                      {vencido ? `⚠️ Vencido hace ${Math.abs(e.diasRestantes)} días` : `⏳ Vence en ${e.diasRestantes} días`}
                    </p>
                    <p style={{ margin: '2px 0 6px', fontSize: 11, color: C.muted }}>{fmtDate(e.fecha_vigencia)}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      {yaEnvio ? (
                        <span style={{ fontSize: 11, color: C.greenText, background: C.greenBg, padding: '3px 8px', borderRadius: 6 }}>
                          ✓ Recordatorio enviado
                        </span>
                      ) : (
                        <button
                          onClick={() => enviarRecordatorio(e)}
                          disabled={enviando === e.id}
                          style={{ ...st.btn, padding: '5px 12px', fontSize: 11, background: vencido ? C.red : C.gold, color: '#fff', opacity: enviando === e.id ? 0.6 : 1 }}>
                          {enviando === e.id ? 'Enviando...' : '📧 Enviar recordatorio'}
                        </button>
                      )}
                      {e.telefono_arrendatario && (
                        <a
                          href={`https://wa.me/52${e.telefono_arrendatario.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${e.nombre_arrendatario}, te contactamos de Emporio Blindaje Legal. Tu contrato de arrendamiento del inmueble en ${e.direccion_inmueble} vence el ${fmtDate(e.fecha_vigencia)}. Por favor comunícate con nosotros para gestionar tu renovación. 📞 2222573237`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ ...st.btn, padding: '5px 12px', fontSize: 11, background: '#25D366', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
                          💬 WA Inquilino
                        </a>
                      )}
                      {e.telefono_arrendador && (
                        <a
                          href={`https://wa.me/52${e.telefono_arrendador.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${e.nombre_arrendador}, te contactamos de Emporio Blindaje Legal. El contrato de arrendamiento del inmueble en ${e.direccion_inmueble} vence el ${fmtDate(e.fecha_vigencia)}. Por favor comunícate con nosotros para coordinar la renovación. 📞 2222573237`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ ...st.btn, padding: '5px 12px', fontSize: 11, background: '#128C7E', color: '#fff', textDecoration: 'none', display: 'inline-block' }}>
                          💬 WA Propietario
                        </a>
                      )}
                      <button
                        onClick={() => onRenovar(e)}
                        style={{ ...st.btn, padding: '5px 12px', fontSize: 11, background: C.blue, color: '#fff' }}>
                        🔄 Renovar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p style={st.sectionTitle}>Expedientes de póliza</p>
      <p style={st.sectionSub}>Haz clic en un expediente para editarlo o generar documentos</p>
      <div style={st.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={st.tableHead}>
            <tr>
              <th style={st.th}>Arrendatario</th>
              <th style={st.th}>Inmueble</th>
              <th style={st.th}>Renta</th>
              <th style={st.th}>Inicio</th>
              <th style={st.th}>Vigencia</th>
              <th style={st.th}>Tipo</th>
              <th style={st.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {expedientes.map(e => {
              const vigenciaColor = (() => {
                if (!e.fecha_vigencia) return C.muted
                const dias = Math.ceil((new Date(e.fecha_vigencia + 'T12:00:00') - new Date()) / (1000 * 60 * 60 * 24))
                if (dias < 0) return C.redText
                if (dias <= 30) return '#c2410c'
                if (dias <= 60) return C.goldText
                return C.greenText
              })()

              return (
                <tr key={e.id} onClick={() => onSelect(e)}
                  style={st.trHover}
                  onMouseEnter={el => el.currentTarget.style.background = '#f9fafb'}
                  onMouseLeave={el => el.currentTarget.style.background = 'transparent'}>
                  <td style={st.td}>
                    <p style={{ margin: 0, fontWeight: 600, color: C.text }}>{e.nombre_arrendatario || '—'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{e.nombre_arrendador || '—'}</p>
                  </td>
                  <td style={st.td}>
                    <p style={{ margin: 0, fontSize: 12, color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.direccion_inmueble || '—'}</p>
                  </td>
                  <td style={st.td}><span style={{ color: C.goldText, fontWeight: 700 }}>{fmt(e.renta_mensual)}</span></td>
                  <td style={st.td}><span style={{ color: C.muted, fontSize: 12 }}>{fmtDate(e.fecha_inicio)}</span></td>
                  <td style={st.td}>
                    <span style={{ color: vigenciaColor, fontSize: 12, fontWeight: e.fecha_vigencia ? 600 : 400 }}>
                      {e.fecha_vigencia ? fmtDate(e.fecha_vigencia) : '—'}
                    </span>
                  </td>
                  <td style={st.td}><span style={{ fontSize: 11, color: C.muted }}>{e.tipo_contrato?.replace(/_/g, ' ') || '—'}</span></td>
                  <td style={st.td}><Badge status={e.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
