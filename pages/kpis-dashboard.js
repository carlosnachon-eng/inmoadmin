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
  const [vista, setVista] = useState('equipo')
  const [mesSeleccionado, setMesSeleccionado] = useState(new Date().getMonth() + 1)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session && ADMINS.includes(session.user.email)) {
      cargarDatos()
    }
  }, [session, mesSeleccionado])

  const cargarDatos = async () => {
    const anio = new Date().getFullYear()
    const mes = mesSeleccionado
    const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = `${anio}-${String(mes).padStart(2, '0')}-31`

    const [{ data: kpisData }, { data: cierresData }] = await Promise.all([
      supabase.from('kpis_diarios').select('*').gte('fecha', inicio).lte('fecha', fin).order('fecha', { ascending: false }),
      supabase.from('cierres').select('*').gte('fecha_cierre', inicio).lte('fecha_cierre', fin),
    ])

    setKpis(kpisData || [])
    setCierres(cierresData || [])
  }

  const statsAsesor = (nombre) => {
    const registros = kpis.filter(k => k.asesor === nombre)
    const diasCapturados = registros.length
    const citas_agendadas = registros.reduce((a, k) => a + (k.citas_agendadas || 0), 0)
    const citas_efectivas = registros.reduce((a, k) => a + (k.citas_efectivas || 0), 0)
    const citas_calificadas = registros.reduce((a, k) => a + (k.citas_calificadas || 0), 0)
    const cierresAsesor = cierres.filter(c => (c.vendedor || '').toLowerCase() === nombre.toLowerCase())
    const operaciones = cierresAsesor.length
    const ingresos = cierresAsesor.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0)
    const conversion = pct(operaciones, citas_calificadas)
    const citasDiariasPromedio = diasCapturados > 0 ? (citas_efectivas / diasCapturados).toFixed(1) : 0
    const okCitas = citasDiariasPromedio >= META_CITAS_DIARIAS
    const okConversion = conversion >= META_CONVERSION * 100
    const okIngresos = ingresos >= META_INGRESOS
    return { diasCapturados, citas_agendadas, citas_efectivas, citas_calificadas, operaciones, ingresos, conversion, citasDiariasPromedio, okCitas, okConversion, okIngresos }
  }

  const hoy = new Date().toISOString().split('T')[0]
  const kpisHoy = kpis.filter(k => k.fecha === hoy)
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

  const Semaforo = ({ ok, label }) => (
    <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", background: ok ? '#00e67622' : '#ff444422', color: ok ? '#00e676' : '#ff4444', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
      {ok ? '✓' : '!'} {label}
    </span>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#666', fontFamily: "'DM Mono', monospace" }}>Cargando...</p>
    </div>
  )

  if (!session || !ADMINS.includes(session.user.email)) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', color: '#f0f0f0', fontFamily: "'Syne', sans-serif" }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>🚫</p>
        <p style={{ fontWeight: 700 }}>Sin acceso</p>
        <button onClick={() => supabase.auth.signOut()} style={{ marginTop: 16, background: '#333', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', cursor: 'pointer' }}>Cerrar sesión</button>
      </div>
    </div>
  )

  const totalEquipo = {
    citas_agendadas: kpis.reduce((a, k) => a + (k.citas_agendadas || 0), 0),
    citas_efectivas: kpis.reduce((a, k) => a + (k.citas_efectivas || 0), 0),
    citas_calificadas: kpis.reduce((a, k) => a + (k.citas_calificadas || 0), 0),
    operaciones: cierres.length,
    ingresos: cierres.reduce((a, c) => a + (parseFloat(c.comision) || 0), 0),
  }

  return (
    <>
      <Head>
        <title>Dashboard KPIs · Emporio</title>
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#f0f0f0', fontFamily: "'Syne', sans-serif" }}>

        <div style={{ background: '#1a1a1a', borderBottom: '1px solid #222', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Emporio Inmobiliario</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Dashboard KPIs</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={mesSeleccionado} onChange={e => setMesSeleccionado(parseInt(e.target.value))}
              style={{ background: '#222', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', color: '#f0f0f0', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer' }}>
              {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <button onClick={() => supabase.auth.signOut()}
              style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, padding: '6px 14px', color: '#666', fontSize: 12, cursor: 'pointer' }}>
              Salir
            </button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {[['equipo', 'Equipo'], ['hoy', 'Hoy'], ['semana', 'Tendencia']].map(([id, label]) => (
              <button key={id} onClick={() => setVista(id)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid ' + (vista === id ? '#00e676' : '#333'), background: vista === id ? '#00e67622' : 'transparent', color: vista === id ? '#00e676' : '#666', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>

          {vista === 'equipo' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
                {[
                  { label: 'Citas agendadas', value: totalEquipo.citas_agendadas, color: '#00e676' },
                  { label: 'Citas efectivas', value: totalEquipo.citas_efectivas, color: '#ffab00' },
                  { label: 'Citas calificadas', value: totalEquipo.citas_calificadas, color: '#ff6b6b' },
                  { label: 'Operaciones', value: totalEquipo.operaciones, color: '#7c6aff' },
                  { label: 'Ingresos equipo', value: fmt(totalEquipo.ingresos), color: '#00e676' },
                ].map((s, i) => (
                  <div key={i} style={{ background: '#1a1a1a', borderRadius: 12, padding: '14px 16px', border: '1px solid #222' }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {ASESORES.map(nombre => {
                  const s = statsAsesor(nombre)
                  return (
                    <div key={nombre} style={{ background: '#1a1a1a', borderRadius: 14, padding: 20, border: '1px solid #222' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{nombre}</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#555', marginTop: 2 }}>{s.diasCapturados} días capturados</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <Semaforo ok={s.okCitas} label="Citas" />
                          <Semaforo ok={s.okConversion} label="Conversión" />
                          <Semaforo ok={s.okIngresos} label="Ingresos" />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                        {[
                          { label: 'Agendadas', value: s.citas_agendadas, color: '#00e676' },
                          { label: 'Efectivas', value: s.citas_efectivas, color: '#ffab00' },
                          { label: 'Calificadas', value: s.citas_calificadas, color: '#ff6b6b' },
                        ].map((c, i) => (
                          <div key={i} style={{ background: '#111', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#555', marginBottom: 4 }}>{c.label}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <div style={{ background: '#111', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#555', marginBottom: 4 }}>Cierres</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: '#7c6aff' }}>{s.operaciones}</div>
                        </div>
                        <div style={{ background: '#111', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#555', marginBottom: 4 }}>Conversión</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: s.okConversion ? '#00e676' : '#ff4444' }}>{s.conversion}%</div>
                        </div>
                        <div style={{ background: '#111', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#555', marginBottom: 4 }}>Prom/día</div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: s.okCitas ? '#00e676' : '#ff4444' }}>{s.citasDiariasPromedio}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {vista === 'hoy' && (
            <div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#555', marginBottom: 16 }}>
                {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
              </div>
              {kpisHoy.length === 0 && (
                <div style={{ background: '#1a1a1a', borderRadius: 14, padding: 40, textAlign: 'center', border: '1px solid #222' }}>
                  <p style={{ color: '#555', fontFamily: "'DM Mono', monospace" }}>Nadie ha capturado hoy todavía</p>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ASESORES.map(nombre => {
                  const reg = kpisHoy.find(k => k.asesor === nombre)
                  return (
                    <div key={nombre} style={{ background: '#1a1a1a', borderRadius: 12, padding: '14px 18px', border: '1px solid ' + (reg ? '#00e67633' : '#222'), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: reg ? '#00e676' : '#333' }} />
                        <span style={{ fontWeight: 700 }}>{nombre}</span>
                      </div>
                      {reg ? (
                        <div style={{ display: 'flex', gap: 16, fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                          <span style={{ color: '#00e676' }}>{reg.citas_agendadas} ag</span>
                          <span style={{ color: '#ffab00' }}>{reg.citas_efectivas} ef</span>
                          <span style={{ color: '#ff6b6b' }}>{reg.citas_calificadas} cal</span>
                        </div>
                      ) : (
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#555' }}>Sin captura</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {vista === 'semana' && (
            <div>
              <div style={{ background: '#1a1a1a', borderRadius: 14, padding: 20, border: '1px solid #222' }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 16 }}>Últimos 14 días — Citas efectivas del equipo</div>
                {(() => {
                  const ultimos14 = []
                  for (let i = 13; i >= 0; i--) {
                    const d = new Date()
                    d.setDate(d.getDate() - i)
                    const fecha = d.toISOString().split('T')[0]
                    const total = kpis.filter(k => k.fecha === fecha).reduce((a, k) => a + (k.citas_efectivas || 0), 0)
                    ultimos14.push({ fecha, total, label: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) })
                  }
                  const max = Math.max(...ultimos14.map(d => d.total), 1)
                  return (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 120 }}>
                      {ultimos14.map((d, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: '#555' }}>{d.total || ''}</div>
                          <div style={{ width: '100%', background: d.total > 0 ? '#00e676' : '#222', borderRadius: 4, height: Math.max((d.total / max) * 80, d.total > 0 ? 4 : 2) }} />
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: '#444', textAlign: 'center' }}>{d.label}</div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
              <div style={{ marginTop: 16, background: '#1a1a1a', borderRadius: 14, padding: 20, border: '1px solid #222' }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 16 }}>Ranking del mes</div>
                {ASESORES
                  .map(nombre => ({ nombre, ...statsAsesor(nombre) }))
                  .sort((a, b) => b.citas_efectivas - a.citas_efectivas)
                  .map((a, i) => (
                    <div key={a.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #222' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: i === 0 ? '#ffab00' : '#555', fontWeight: 700 }}>#{i + 1}</span>
                        <span style={{ fontWeight: 700 }}>{a.nombre}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        <span style={{ color: '#ffab00' }}>{a.citas_efectivas} citas</span>
                        <span style={{ color: '#7c6aff' }}>{a.operaciones} cierres</span>
                        <span style={{ color: '#00e676' }}>{a.conversion}% conv</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
