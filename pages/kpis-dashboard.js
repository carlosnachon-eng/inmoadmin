import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import Head from 'next/head'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const ADMINS = [
  'carlos.nachon@emporioinmobiliario.mx',
  'guillermo@emporioinmobiliario.com.mx',
]

const ASESORES = ['Ariannet', 'Angélica', 'Rosario', 'Iván', 'Andrea', 'Guillermo']

const VENDEDOR_MAP = {
  'Ariannet': 'ari', 'Angélica': 'angelica', 'Iván': 'ivan',
  'Rosario': 'rosario', 'Andrea': 'andrea', 'Guillermo': 'guillermo',
}

const MEDALLAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣']
const META_CITAS_DIARIAS = 2
const META_CONVERSION = 0.15
const META_INGRESOS = 90000

const fmt = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 })
const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0

export default function KPIsDashboard() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState([])
  const [cierres, setCierres] = useState([])
  const [vista, setVista] = useState('ranking')
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth() + 1)
  const [animado, setAnimado] = useState(false)
  const [filtroAsesor, setFiltroAsesor] = useState('Todos')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session && ADMINS.includes(session.user.email)) cargarDatos()
  }, [session, mesSeleccionado])

  useEffect(() => {
    setAnimado(false)
    const t = setTimeout(() => setAnimado(true), 100)
    return () => clearTimeout(t)
  }, [vista, mesSeleccionado])

  const cargarDatos = async () => {
    const anio = new Date().getFullYear()
    const mes = mesSeleccionado
    const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0).toISOString().split('T')[0]
    const [{ data: kpisData }, { data: cierresData }] = await Promise.all([
      supabase.from('kpis_diarios').select('*').gte('fecha', inicio).lte('fecha', fin).order('fecha', { ascending: false }),
      supabase.from('cierres').select('*').gte('fecha_cierre', inicio).lte('fecha_cierre', fin),
    ])
    setKpis(kpisData || [])
    setCierres(cierresData || [])
    setAnimado(false)
    setTimeout(() => setAnimado(true), 100)
  }

  const statsAsesor = (nombre) => {
    const registros = kpis.filter(k => k.asesor === nombre)
    const diasCapturados = registros.length
    const citas_agendadas = registros.reduce((a, k) => a + (k.citas_agendadas || 0), 0)
    const citas_efectivas = registros.reduce((a, k) => a + (k.citas_efectivas || 0), 0)
    const citas_calificadas = registros.reduce((a, k) => a + (k.citas_calificadas || 0), 0)
    const vendedorKey = VENDEDOR_MAP[nombre] || nombre.toLowerCase()
    const cierresAsesor = cierres.filter(c => (c.vendedor || '').toLowerCase() === vendedorKey)
    const operaciones = cierresAsesor.length
    const ingresos = cierresAsesor.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0)
    const conversion = pct(operaciones, citas_calificadas)
    const citasDiariasPromedio = diasCapturados > 0 ? (citas_efectivas / diasCapturados).toFixed(1) : 0
    const progreso = Math.min((ingresos / META_INGRESOS) * 100, 100)
    return { diasCapturados, citas_agendadas, citas_efectivas, citas_calificadas, operaciones, ingresos, conversion, citasDiariasPromedio, progreso }
  }

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const kpisHoy = kpis.filter(k => k.fecha === hoy)
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

  const rankingData = ASESORES
    .map(nombre => ({ nombre, ...statsAsesor(nombre) }))
    .sort((a, b) => b.operaciones - a.operaciones || b.ingresos - a.ingresos)

  const totalEquipo = {
    citas_agendadas: kpis.reduce((a, k) => a + (k.citas_agendadas || 0), 0),
    citas_efectivas: kpis.reduce((a, k) => a + (k.citas_efectivas || 0), 0),
    operaciones: cierres.length,
    ingresos: cierres.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0),
  }

  const Semaforo = ({ ok, label }) => (
    <span style={{ fontSize: 10, background: ok ? '#b91c3c22' : '#fee2e2', color: ok ? '#b91c3c' : '#991b1b', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
      {ok ? '✓' : '!'} {label}
    </span>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  )

  if (!session || !ADMINS.includes(session.user.email)) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', background: '#fff', padding: 40, borderRadius: 16, border: '1px solid #e5e7eb' }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, marginBottom: 16 }} />
        <p style={{ fontSize: 16, fontWeight: 700, color: '#4a4a4a', marginBottom: 8 }}>Sin acceso</p>
        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>Esta página es solo para administradores</p>
        <button onClick={() => supabase.auth.signOut()} style={{ background: '#b91c3c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 700 }}>Salir</button>
      </div>
    </div>
  )

  const detallesFiltrados = filtroAsesor === 'Todos' ? kpis : kpis.filter(k => k.asesor === filtroAsesor)

  return (
    <>
      <Head>
        <title>KPIs Emporio · Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          .card { animation: slideUp 0.4s ease forwards; }
          .card:nth-child(1) { animation-delay: 0.05s; }
          .card:nth-child(2) { animation-delay: 0.1s; }
          .card:nth-child(3) { animation-delay: 0.15s; }
          .card:nth-child(4) { animation-delay: 0.2s; }
          .card:nth-child(5) { animation-delay: 0.25s; }
          .card:nth-child(6) { animation-delay: 0.3s; }
        `}</style>
      </Head>

      <div style={{ minHeight: '100vh', background: '#f8f8f8', color: '#4a4a4a', fontFamily: 'system-ui, sans-serif' }}>

        {/* HEADER */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 20px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 32, objectFit: 'contain' }} />
              <div>
                <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Sistema de KPIs</p>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#4a4a4a' }}>Scoreboard — {meses[mesSeleccionado - 1]}</h1>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={mesSeleccionado} onChange={e => setMesSeleccionado(parseInt(e.target.value))}
                style={{ background: '#f8f8f8', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 12px', color: '#4a4a4a', fontSize: 13, cursor: 'pointer' }}>
                {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <button onClick={() => supabase.auth.signOut()}
                style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 14px', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
                Salir
              </button>
            </div>
          </div>
        </div>

        {/* TOTALES */}
        <div style={{ background: '#b91c3c', padding: '14px 20px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'Citas agendadas', value: totalEquipo.citas_agendadas },
              { label: 'Citas efectivas', value: totalEquipo.citas_efectivas },
              { label: 'Operaciones', value: totalEquipo.operaciones },
              { label: 'Ingresos equipo', value: fmt(totalEquipo.ingresos) },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* TABS */}
        <div style={{ padding: '16px 20px 0', maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {[['ranking', '🏆 Ranking'], ['equipo', '📊 Equipo'], ['hoy', '📍 Hoy'], ['detalle', '📋 Detalle']].map(([id, label]) => (
              <button key={id} onClick={() => setVista(id)}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${vista === id ? '#b91c3c' : '#e5e7eb'}`, background: vista === id ? '#fff0f3' : '#fff', color: vista === id ? '#b91c3c' : '#9ca3af', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '0 20px 40px', maxWidth: 900, margin: '0 auto' }}>

          {/* RANKING */}
          {vista === 'ranking' && (
            <div>
              <p style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase' }}>Ordenado por cierres · Desempate por ingresos</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rankingData.map((a, i) => {
                  const esPrimero = i === 0
                  const barColor = i === 0 ? '#b91c3c' : i === 1 ? '#7f1d2e' : i === 2 ? '#dc2626' : '#e5e7eb'
                  return (
                    <div key={a.nombre} className={animado ? 'card' : ''} style={{ opacity: animado ? 1 : 0 }}>
                      <div style={{ background: esPrimero ? '#fff0f3' : '#fff', border: `1px solid ${esPrimero ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 12, padding: '16px 20px', display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 16, alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
                        {esPrimero && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#b91c3c' }} />}
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: i < 3 ? 28 : 18 }}>{MEDALLAS[i]}</div>
                          <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>#{i + 1}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: esPrimero ? '#b91c3c' : '#4a4a4a', marginBottom: 8 }}>{a.nombre}</div>
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 10, color: '#9ca3af' }}>Meta $90K</span>
                              <span style={{ fontSize: 10, color: a.progreso >= 100 ? '#065f46' : '#9ca3af' }}>{Math.round(a.progreso)}%</span>
                            </div>
                            <div style={{ background: '#f3f4f6', borderRadius: 99, height: 5 }}>
                              <div style={{ height: '100%', borderRadius: 99, background: a.progreso >= 100 ? '#065f46' : '#b91c3c', width: `${a.progreso}%`, transition: 'width 1s ease' }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>Citas <strong style={{ color: '#4a4a4a' }}>{a.citas_efectivas}</strong></span>
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>Ingresos <strong style={{ color: '#065f46' }}>{fmt(a.ingresos)}</strong></span>
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>Conv <strong style={{ color: a.conversion >= 15 ? '#065f46' : '#9ca3af' }}>{a.conversion}%</strong></span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color: a.operaciones > 0 ? '#b91c3c' : '#e5e7eb' }}>{a.operaciones}</div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>CIERRES</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* EQUIPO */}
          {vista === 'equipo' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {ASESORES.map(nombre => {
                const s = statsAsesor(nombre)
                return (
                  <div key={nombre} className={animado ? 'card' : ''} style={{ opacity: animado ? 1 : 0, background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#4a4a4a' }}>{nombre}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{s.diasCapturados} días capturados</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                        <Semaforo ok={s.citasDiariasPromedio >= META_CITAS_DIARIAS} label="Citas" />
                        <Semaforo ok={s.conversion >= META_CONVERSION * 100} label="Conv." />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                      {[
                        { l: 'Agend', v: s.citas_agendadas, c: '#065f46', bg: '#f0fdf4' },
                        { l: 'Efect', v: s.citas_efectivas, c: '#92400e', bg: '#fffbeb' },
                        { l: 'Calif', v: s.citas_calificadas, c: '#b91c3c', bg: '#fff0f3' },
                      ].map((x, i) => (
                        <div key={i} style={{ background: x.bg, borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 2 }}>{x.l}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: x.c }}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: '#f8f8f8', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 9, color: '#9ca3af' }}>Cierres</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: s.operaciones > 0 ? '#b91c3c' : '#e5e7eb' }}>{s.operaciones}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: '#9ca3af' }}>Ingresos</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: s.ingresos > 0 ? '#065f46' : '#e5e7eb' }}>{fmt(s.ingresos)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: '#9ca3af' }}>Conv</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: s.conversion >= 15 ? '#065f46' : '#9ca3af' }}>{s.conversion}%</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* HOY */}
          {vista === 'hoy' && (
            <div>
              <p style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase' }}>
                {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ASESORES.map((nombre) => {
                  const reg = kpisHoy.find(k => k.asesor === nombre)
                  return (
                    <div key={nombre} className={animado ? 'card' : ''} style={{ opacity: animado ? 1 : 0, background: reg ? '#fff0f3' : '#fff', border: `1px solid ${reg ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: reg ? '#b91c3c' : '#e5e7eb' }} />
                        <span style={{ fontSize: 15, fontWeight: 700, color: reg ? '#4a4a4a' : '#9ca3af' }}>{nombre}</span>
                      </div>
                      {reg ? (
                        <div style={{ display: 'flex', gap: 20 }}>
                          {[['AG', reg.citas_agendadas, '#065f46'], ['EF', reg.citas_efectivas, '#92400e'], ['CAL', reg.citas_calificadas, '#b91c3c']].map(([l, v, c]) => (
                            <div key={l} style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
                              <div style={{ fontSize: 9, color: '#9ca3af' }}>{l}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>Sin captura hoy</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* DETALLE */}
          {vista === 'detalle' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <p style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 1, textTransform: 'uppercase' }}>Registro diario — {meses[mesSeleccionado - 1]}</p>
                <select value={filtroAsesor} onChange={e => setFiltroAsesor(e.target.value)}
                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 12px', color: '#4a4a4a', fontSize: 13, cursor: 'pointer' }}>
                  <option value="Todos">Todos los asesores</option>
                  {ASESORES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              {detallesFiltrados.length === 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center', border: '1px solid #e5e7eb' }}>
                  <p style={{ color: '#9ca3af' }}>Sin registros este periodo</p>
                </div>
              )}
              {detallesFiltrados.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f8f8f8' }}>
                        {['Fecha', 'Asesor', 'Agend', 'Efect', 'Calif', 'Cierres', 'Ingresos', '✓'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detallesFiltrados.map((r) => {
                        const cumpleMeta = r.citas_efectivas >= META_CITAS_DIARIAS
                        const vendedorKey = VENDEDOR_MAP[r.asesor] || r.asesor.toLowerCase()
                        const cierresDia = cierres.filter(c => (c.vendedor || '').toLowerCase() === vendedorKey && c.fecha_cierre === r.fecha)
                        const ingresosDia = cierresDia.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0)
                        return (
                          <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6', background: cumpleMeta ? '#fff0f3' : 'transparent' }}>
                            <td style={{ padding: '10px 14px', fontSize: 12, color: '#9ca3af' }}>{r.fecha}</td>
                            <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#4a4a4a' }}>{r.asesor}</td>
                            <td style={{ padding: '10px 14px', fontSize: 15, fontWeight: 800, color: '#065f46' }}>{r.citas_agendadas}</td>
                            <td style={{ padding: '10px 14px', fontSize: 15, fontWeight: 800, color: '#92400e' }}>{r.citas_efectivas}</td>
                            <td style={{ padding: '10px 14px', fontSize: 15, fontWeight: 800, color: '#b91c3c' }}>{r.citas_calificadas}</td>
                            <td style={{ padding: '10px 14px', fontSize: 15, fontWeight: 800, color: cierresDia.length > 0 ? '#7c3aed' : '#e5e7eb' }}>{cierresDia.length || '—'}</td>
                            <td style={{ padding: '10px 14px', fontSize: 12, color: ingresosDia > 0 ? '#065f46' : '#e5e7eb', fontWeight: 600 }}>{ingresosDia > 0 ? fmt(ingresosDia) : '—'}</td>
                            <td style={{ padding: '10px 14px', fontSize: 14 }}>{cumpleMeta ? <span style={{ color: '#065f46' }}>✓</span> : <span style={{ color: '#b91c3c' }}>✗</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
