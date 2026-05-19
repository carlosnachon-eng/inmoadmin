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
  'Ariannet': 'ari',
  'Angélica': 'angelica',
  'Iván': 'ivan',
  'Rosario': 'rosario',
  'Andrea': 'andrea',
  'Guillermo': 'guillermo',
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
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
    <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", background: ok ? '#00e67622' : '#ff444422', color: ok ? '#00e676' : '#ff4444', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
      {ok ? '✓' : '!'} {label}
    </span>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'monospace', letterSpacing: 4 }}>CARGANDO...</p>
    </div>
  )

  if (!session || !ADMINS.includes(session.user.email)) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#f0f0f0' }}>
        <p style={{ fontSize: 32 }}>🚫</p>
        <p style={{ fontFamily: 'monospace' }}>SIN ACCESO</p>
        <button onClick={() => supabase.auth.signOut()} style={{ marginTop: 16, background: '#222', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', cursor: 'pointer' }}>SALIR</button>
      </div>
    </div>
  )

  const detallesFiltrados = filtroAsesor === 'Todos'
    ? kpis
    : kpis.filter(k => k.asesor === filtroAsesor)

  return (
    <>
      <Head>
        <title>KPIs Emporio · Scoreboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #0a0a0a; }
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

      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f0f0f0', fontFamily: "'Syne', sans-serif" }}>

        {/* HEADER */}
        <div style={{ background: 'linear-gradient(180deg, #111 0%, #0a0a0a 100%)', borderBottom: '1px solid #1a1a1a', padding: '14px 20px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, lineHeight: 1 }}>EMPORIO <span style={{ color: '#00e676' }}>SCOREBOARD</span></div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#444', letterSpacing: 2, marginTop: 2 }}>{meses[mesSeleccionado - 1].toUpperCase()} 2026</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={mesSeleccionado} onChange={e => setMesSeleccionado(parseInt(e.target.value))}
                style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '6px 10px', color: '#888', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer' }}>
                {meses.map((m, i) => <option key={i} value={i + 1}>{m.toUpperCase()}</option>)}
              </select>
              <button onClick={() => supabase.auth.signOut()}
                style={{ background: 'transparent', border: '1px solid #222', borderRadius: 6, padding: '6px 12px', color: '#444', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                SALIR
              </button>
            </div>
          </div>
        </div>

        {/* TOTALES */}
        <div style={{ background: '#0f0f0f', borderBottom: '1px solid #1a1a1a', padding: '12px 20px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'CITAS AGENDADAS', value: totalEquipo.citas_agendadas, color: '#00e676' },
              { label: 'CITAS EFECTIVAS', value: totalEquipo.citas_efectivas, color: '#ffab00' },
              { label: 'OPERACIONES', value: totalEquipo.operaciones, color: '#7c6aff' },
              { label: 'INGRESOS EQUIPO', value: fmt(totalEquipo.ingresos), color: '#00e676' },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#444', letterSpacing: 2, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: s.color, letterSpacing: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* TABS */}
        <div style={{ padding: '16px 20px 0', maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {[['ranking', '🏆 RANKING'], ['equipo', '📊 EQUIPO'], ['hoy', '📍 HOY'], ['detalle', '📋 DETALLE']].map(([id, label]) => (
              <button key={id} onClick={() => setVista(id)}
                style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid ' + (vista === id ? '#00e676' : '#222'), background: vista === id ? '#00e67611' : 'transparent', color: vista === id ? '#00e676' : '#444', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Mono', monospace", letterSpacing: 1 }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '0 20px 40px', maxWidth: 900, margin: '0 auto' }}>

          {/* RANKING */}
          {vista === 'ranking' && (
            <div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#333', letterSpacing: 2, marginBottom: 16 }}>ORDENADO POR CIERRES · DESEMPATE POR INGRESOS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rankingData.map((a, i) => {
                  const esPrimero = i === 0
                  const barColor = i === 0 ? '#00e676' : i === 1 ? '#ffab00' : i === 2 ? '#ff6b6b' : '#444'
                  return (
                    <div key={a.nombre} className={animado ? 'card' : ''} style={{ opacity: animado ? 1 : 0 }}>
                      <div style={{
                        background: esPrimero ? 'linear-gradient(135deg, #0a1a0a, #0f2a0f)' : '#111',
                        border: `1px solid ${esPrimero ? '#00e67633' : '#1a1a1a'}`,
                        borderRadius: 12, padding: '16px 20px',
                        display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 16, alignItems: 'center',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {esPrimero && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #00e676, transparent)' }} />}
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: i < 3 ? 28 : 18 }}>{MEDALLAS[i]}</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#333', marginTop: 2 }}>#{i + 1}</div>
                        </div>
                        <div>
                          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 2, color: esPrimero ? '#00e676' : '#f0f0f0', marginBottom: 8 }}>{a.nombre.toUpperCase()}</div>
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#444' }}>META $90K</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: a.progreso >= 100 ? '#00e676' : '#555' }}>{Math.round(a.progreso)}%</span>
                            </div>
                            <div style={{ background: '#1a1a1a', borderRadius: 99, height: 4 }}>
                              <div style={{ height: '100%', borderRadius: 99, background: a.progreso >= 100 ? '#00e676' : a.progreso >= 50 ? '#ffab00' : barColor, width: `${a.progreso}%`, transition: 'width 1s ease' }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 16 }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#444' }}>CITAS <span style={{ color: '#ffab00' }}>{a.citas_efectivas}</span></span>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#444' }}>INGRESOS <span style={{ color: '#00e676' }}>{fmt(a.ingresos)}</span></span>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#444' }}>CONV <span style={{ color: a.conversion >= 15 ? '#00e676' : '#555' }}>{a.conversion}%</span></span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, lineHeight: 1, color: a.operaciones > 0 ? barColor : '#222', letterSpacing: 2 }}>{a.operaciones}</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#333', letterSpacing: 1 }}>CIERRES</div>
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
                  <div key={nombre} className={animado ? 'card' : ''} style={{ opacity: animado ? 1 : 0, background: '#111', borderRadius: 12, padding: 16, border: '1px solid #1a1a1a' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2 }}>{nombre.toUpperCase()}</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#444', marginTop: 2 }}>{s.diasCapturados} DÍAS</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                        <Semaforo ok={s.citasDiariasPromedio >= META_CITAS_DIARIAS} label="Citas" />
                        <Semaforo ok={s.conversion >= META_CONVERSION * 100} label="Conv." />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                      {[
                        { l: 'AGEND', v: s.citas_agendadas, c: '#00e676' },
                        { l: 'EFECT', v: s.citas_efectivas, c: '#ffab00' },
                        { l: 'CALIF', v: s.citas_calificadas, c: '#ff6b6b' },
                      ].map((x, i) => (
                        <div key={i} style={{ background: '#0a0a0a', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#333' }}>{x.l}</div>
                          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: x.c, letterSpacing: 1 }}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: '#0a0a0a', borderRadius: 6, padding: '8px 10px', display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#333' }}>CIERRES</div>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: s.operaciones > 0 ? '#00e676' : '#333' }}>{s.operaciones}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#333' }}>INGRESOS</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: s.ingresos > 0 ? '#00e676' : '#333' }}>{fmt(s.ingresos)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#333' }}>CONV</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: s.conversion >= 15 ? '#00e676' : '#555' }}>{s.conversion}%</div>
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
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#333', letterSpacing: 2, marginBottom: 16 }}>
                {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ASESORES.map((nombre, i) => {
                  const reg = kpisHoy.find(k => k.asesor === nombre)
                  return (
                    <div key={nombre} className={animado ? 'card' : ''} style={{ opacity: animado ? 1 : 0,
                      background: reg ? '#0a1a0a' : '#111',
                      border: `1px solid ${reg ? '#00e67633' : '#1a1a1a'}`,
                      borderRadius: 10, padding: '14px 18px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: reg ? '#00e676' : '#222', boxShadow: reg ? '0 0 8px #00e676' : 'none' }} />
                        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, color: reg ? '#f0f0f0' : '#444' }}>{nombre.toUpperCase()}</span>
                      </div>
                      {reg ? (
                        <div style={{ display: 'flex', gap: 20 }}>
                          {[['AG', reg.citas_agendadas, '#00e676'], ['EF', reg.citas_efectivas, '#ffab00'], ['CAL', reg.citas_calificadas, '#ff6b6b']].map(([l, v, c]) => (
                            <div key={l} style={{ textAlign: 'center' }}>
                              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: c, letterSpacing: 1 }}>{v}</div>
                              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#444' }}>{l}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#333', letterSpacing: 1 }}>SIN CAPTURA</span>
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
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#333', letterSpacing: 2 }}>
                  REGISTRO DIARIO — {meses[mesSeleccionado - 1].toUpperCase()}
                </div>
                <select value={filtroAsesor} onChange={e => setFiltroAsesor(e.target.value)}
                  style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '6px 10px', color: '#888', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer' }}>
                  <option value="Todos">TODOS LOS ASESORES</option>
                  {ASESORES.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                </select>
              </div>

              {detallesFiltrados.length === 0 && (
                <div style={{ background: '#111', borderRadius: 12, padding: 40, textAlign: 'center', border: '1px solid #1a1a1a' }}>
                  <p style={{ color: '#333', fontFamily: "'DM Mono', monospace" }}>SIN REGISTROS</p>
                </div>
              )}

              <div style={{ background: '#111', borderRadius: 12, overflow: 'hidden', border: '1px solid #1a1a1a' }}>
                {detallesFiltrados.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#1a1a1a' }}>
                        {['FECHA', 'ASESOR', 'AGENDADAS', 'EFECTIVAS', 'CALIFICADAS', 'CIERRES', 'INGRESOS', '✓ META'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#555', letterSpacing: 1 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detallesFiltrados.map((r, i) => {
                        const cumpleMeta = r.citas_efectivas >= META_CITAS_DIARIAS
                        const vendedorKey = VENDEDOR_MAP[r.asesor] || r.asesor.toLowerCase()
                        const cierresDia = cierres.filter(c => (c.vendedor || '').toLowerCase() === vendedorKey && c.fecha_cierre === r.fecha)
                        const ingresosDia = cierresDia.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0)
                        return (
                          <tr key={r.id} style={{ borderTop: '1px solid #1a1a1a', background: cumpleMeta ? '#0a1a0a' : 'transparent' }}>
                            <td style={{ padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#666' }}>{r.fecha}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: 1, color: '#f0f0f0' }}>{r.asesor}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: '#00e676', letterSpacing: 1 }}>{r.citas_agendadas}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: '#ffab00', letterSpacing: 1 }}>{r.citas_efectivas}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: '#ff6b6b', letterSpacing: 1 }}>{r.citas_calificadas}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: cierresDia.length > 0 ? '#7c6aff' : '#333', letterSpacing: 1 }}>{cierresDia.length || '—'}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: ingresosDia > 0 ? '#00e676' : '#333' }}>{ingresosDia > 0 ? fmt(ingresosDia) : '—'}</td>
                            <td style={{ padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                              {cumpleMeta
                                ? <span style={{ color: '#00e676' }}>✓</span>
                                : <span style={{ color: '#ff4444' }}>✗</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
