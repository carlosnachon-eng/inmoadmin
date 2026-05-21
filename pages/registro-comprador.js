import { useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const S = {
  page: { minHeight: '100vh', background: '#f8f8f8', fontFamily: "system-ui, sans-serif", color: '#374151', paddingBottom: 60 },
  header: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  logo: { height: 52, objectFit: 'contain' },
  hero: { textAlign: 'center', padding: '28px 20px 12px' },
  heroTitle: { fontSize: 26, fontWeight: 800, color: '#4a4a4a', margin: '0 0 8px' },
  heroSub: { color: '#7a7a7a', fontSize: 14, margin: 0 },
  progress: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 20px' },
  dot: { width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', border: '2px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#9ca3af', flexShrink: 0 },
  dotActive: { background: '#b91c3c', border: '2px solid #b91c3c', color: '#fff' },
  dotDone: { background: '#065f46', border: '2px solid #065f46', color: '#fff' },
  line: { width: 40, height: 2, background: '#e5e7eb', margin: '0 8px' },
  lineDone: { background: '#065f46' },
  card: { maxWidth: 580, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '32px 28px', marginLeft: 16, marginRight: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  title: { fontSize: 22, fontWeight: 800, color: '#4a4a4a', margin: '0 0 6px' },
  desc: { color: '#7a7a7a', fontSize: 13, margin: '0 0 24px', lineHeight: 1.5 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
  input: { width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  inputErr: { borderColor: '#b91c3c' },
  select: { width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' },
  divider: { height: 1, background: '#e5e7eb', margin: '24px 0' },
  errMsg: { color: '#b91c3c', fontSize: 12, margin: '6px 0 0' },
  globalErr: { background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#b91c3c', fontSize: 14, marginBottom: 16 },
  fileBox: { border: '2px dashed #e5e7eb', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' },
  fileBoxDone: { border: '2px dashed #b91c3c', background: '#fff0f3' },
  fileBoxErr: { border: '2px dashed #b91c3c' },
  privacy: { fontSize: 12, color: '#7a7a7a', lineHeight: 1.6, marginTop: 20, padding: '14px', background: '#f8f8f8', borderRadius: 8, border: '1px solid #e5e7eb' },
  btnRow: { display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' },
  btnBack: { padding: '12px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#7a7a7a', fontSize: 14, cursor: 'pointer' },
  btnNext: { padding: '12px 28px', borderRadius: 8, border: 'none', background: '#b91c3c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  successIcon: { width: 64, height: 64, borderRadius: '50%', background: '#fff0f3', color: '#b91c3c', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' },
}

const Field = ({ label, error, children, required }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={S.label}>{label}{required && <span style={{ color: '#b91c3c' }}> *</span>}</label>
    {children}
    {error && <p style={S.errMsg}>{error}</p>}
  </div>
)

const FileBox = ({ label, hint, file, onFile, error, required }) => {
  const ref = useRef()
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={S.label}>{label}{required && <span style={{ color: '#b91c3c' }}> *</span>}</label>
      <div onClick={() => ref.current.click()}
        style={{ ...S.fileBox, ...(file ? S.fileBoxDone : {}), ...(error ? S.fileBoxErr : {}) }}>
        <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
          onChange={e => onFile(e.target.files[0])} />
        <span style={{ display: 'block', fontSize: 22, marginBottom: 6, color: file ? '#065f46' : '#b91c3c' }}>
          {file ? '✓' : '↑'}
        </span>
        <span style={{ display: 'block', fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 3 }}>
          {file ? file.name : hint}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: '#9ca3af' }}>
          {file ? 'Toca para cambiar' : 'PDF, JPG o PNG · máx 10 MB'}
        </span>
      </div>
      {error && <p style={S.errMsg}>{error}</p>}
    </div>
  )
}

export default function RegistroComprador() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitId, setSubmitId] = useState(null)
  const [docIdentificacion, setDocIdentificacion] = useState(null)
  const [tieneConyuge, setTieneConyuge] = useState('no')
  const [conyuge, setConyuge] = useState({ nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' })
  const formRef = useRef(null)
  const saved = useRef({})

  const getVals = () => {
    const v = { ...saved.current }
    if (formRef.current) {
      formRef.current.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => { v[el.name] = el.value })
    }
    return v
  }

  const saveStep = () => {
    if (!formRef.current) return
    formRef.current.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => { saved.current[el.name] = el.value })
  }

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file)
  })

  const validateStep1 = () => {
    const v = getVals(); const e = {}
    if (!v.nombre_comprador?.trim()) e.nombre_comprador = 'Requerido'
    if (!v.celular?.trim()) e.celular = 'Requerido'
    if (!v.correo?.trim()) e.correo = 'Requerido'
    if (!v.rfc?.trim()) e.rfc = 'Requerido'
    setErrors(e); return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const v = getVals(); const e = {}
    if (!v.inmueble_interes?.trim()) e.inmueble_interes = 'Requerido'
    if (!v.precio_pactado?.trim()) e.precio_pactado = 'Requerido'
    if (!docIdentificacion) e.doc_identificacion = 'Requerido'
    setErrors(e); return Object.keys(e).length === 0
  }

  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2) { handleSubmit(); return }
    saveStep(); setStep(2)
  }

  const handleSubmit = async () => {
    if (!validateStep2()) return
    setLoading(true)
    try {
      const v = getVals()
      const payload = {
        nombre_comprador: v.nombre_comprador, domicilio_comprador: v.domicilio_comprador,
        ocupacion_comprador: v.ocupacion, empresa_comprador: v.empresa_labora,
        estado_civil_comprador: v.estado_civil, regimen_conyugal: v.regimen_conyugal,
        telefono_fijo_comprador: v.telefono_fijo, celular_comprador: v.celular,
        correo_comprador: v.correo, nss_comprador: v.nss,
        lugar_nacimiento_comprador: v.lugar_nacimiento, tipo_identificacion_comprador: v.tipo_identificacion,
        folio_identificacion_comprador: v.folio_identificacion, rfc_comprador: v.rfc,
        curp_comprador: v.curp, fecha_nacimiento_comprador: v.fecha_nacimiento || null,
        inmueble_interes: v.inmueble_interes, precio_pactado: parseFloat(v.precio_pactado) || null,
        fecha_apartado: v.fecha_apartado || null, asesor_ventas: v.asesor_ventas,
        forma_pago_compra: v.forma_pago, notaria: v.notaria,
        tiene_conyuge: tieneConyuge === 'si',
        ...(tieneConyuge === 'si' ? { conyuge_nombre: conyuge.nombre, conyuge_telefono: conyuge.telefono, conyuge_correo: conyuge.correo, conyuge_rfc: conyuge.rfc, conyuge_tipo_id: conyuge.tipo_id } : {}),
      }
      const { data, error } = await supabase.from('compradores').insert(payload).select('id').single()
      if (error) throw error
      if (docIdentificacion) {
        const b64 = await fileToBase64(docIdentificacion)
        await supabase.from('compradores').update({ doc_identificacion_b64: b64 }).eq('id', data.id)
      }
      setSubmitId(data.id); setStep(3)
    } catch (err) { console.error(err); setErrors({ global: 'Ocurrió un error. Por favor intenta de nuevo.' }) }
    finally { setLoading(false) }
  }

  const STEPS = [{ id: 1, label: 'Datos personales' }, { id: 2, label: 'Compra e identificación' }]

  return (
    <>
      <Head>
        <title>Registro de comprador — Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={S.page}>
        <header style={S.header}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={S.logo} />
        </header>
        <div style={S.hero}>
          <h1 style={S.heroTitle}>Datos del comprador</h1>
          <p style={S.heroSub}>Emporio Inmobiliario — Puebla, México</p>
        </div>

        {step < 3 && (
          <div style={S.progress}>
            {STEPS.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ ...S.dot, ...(step === s.id ? S.dotActive : step > s.id ? S.dotDone : {}) }}>
                    {step > s.id ? '✓' : s.id}
                  </div>
                  <span style={{ fontSize: 10, color: step === s.id ? '#b91c3c' : '#9ca3af' }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div style={{ ...S.line, ...(step > s.id ? S.lineDone : {}), marginBottom: 16 }} />}
              </div>
            ))}
          </div>
        )}

        <div style={S.card} ref={formRef}>
          {step === 1 && (
            <>
              <h2 style={S.title}>Datos personales</h2>
              <p style={S.desc}>Complete todos los campos requeridos para procesar su solicitud de compra.</p>
              <Field label="Nombre completo" required error={errors.nombre_comprador}>
                <input name="nombre_comprador" type="text" placeholder="Como aparece en su identificación" defaultValue={saved.current.nombre_comprador || ''} style={{ ...S.input, ...(errors.nombre_comprador ? S.inputErr : {}) }} />
              </Field>
              <Field label="Domicilio">
                <textarea name="domicilio_comprador" rows={2} placeholder="Calle, número, colonia, municipio, estado" defaultValue={saved.current.domicilio_comprador || ''} style={{ ...S.input, resize: 'vertical' }} />
              </Field>
              <Field label="Ocupación">
                <input name="ocupacion" type="text" placeholder="Ej: Médico, Ingeniero, Empresario..." defaultValue={saved.current.ocupacion || ''} style={S.input} />
              </Field>
              <Field label="Empresa donde labora">
                <input name="empresa_labora" type="text" placeholder="Nombre de la empresa o negocio" defaultValue={saved.current.empresa_labora || ''} style={S.input} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Estado civil">
                  <select name="estado_civil" defaultValue={saved.current.estado_civil || ''} style={S.select}>
                    <option value="">Seleccionar</option>
                    <option value="Soltero(a)">Soltero(a)</option>
                    <option value="Casado(a)">Casado(a)</option>
                    <option value="Divorciado(a)">Divorciado(a)</option>
                    <option value="Viudo(a)">Viudo(a)</option>
                    <option value="Unión libre">Unión libre</option>
                  </select>
                </Field>
                <Field label="Régimen conyugal">
                  <select name="regimen_conyugal" defaultValue={saved.current.regimen_conyugal || ''} style={S.select}>
                    <option value="">N/A</option>
                    <option value="Bienes mancomunados">Bienes mancomunados</option>
                    <option value="Separación de bienes">Separación de bienes</option>
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Teléfono fijo">
                  <input name="telefono_fijo" type="tel" placeholder="222 000 0000" defaultValue={saved.current.telefono_fijo || ''} style={S.input} />
                </Field>
                <Field label="Celular" required error={errors.celular}>
                  <input name="celular" type="tel" placeholder="222 000 0000" defaultValue={saved.current.celular || ''} style={{ ...S.input, ...(errors.celular ? S.inputErr : {}) }} />
                </Field>
              </div>
              <Field label="Correo electrónico" required error={errors.correo}>
                <input name="correo" type="email" placeholder="correo@ejemplo.com" defaultValue={saved.current.correo || ''} style={{ ...S.input, ...(errors.correo ? S.inputErr : {}) }} />
              </Field>
              <Field label="NSS"><input name="nss" type="text" placeholder="11 dígitos" defaultValue={saved.current.nss || ''} style={S.input} /></Field>
              <Field label="Lugar de nacimiento"><input name="lugar_nacimiento" type="text" placeholder="Ciudad, Estado" defaultValue={saved.current.lugar_nacimiento || ''} style={S.input} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Tipo de identificación">
                  <select name="tipo_identificacion" defaultValue={saved.current.tipo_identificacion || 'INE'} style={S.select}>
                    <option value="INE">INE</option><option value="Pasaporte">Pasaporte</option><option value="Cédula profesional">Cédula profesional</option>
                  </select>
                </Field>
                <Field label="Folio de identificación"><input name="folio_identificacion" type="text" placeholder="Número/folio" defaultValue={saved.current.folio_identificacion || ''} style={S.input} /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="RFC" required error={errors.rfc}>
                  <input name="rfc" type="text" placeholder="XXXX000000XXX" defaultValue={saved.current.rfc || ''} style={{ ...S.input, ...(errors.rfc ? S.inputErr : {}) }} />
                </Field>
                <Field label="CURP"><input name="curp" type="text" placeholder="18 caracteres" defaultValue={saved.current.curp || ''} style={S.input} /></Field>
              </div>
              <Field label="Fecha de nacimiento"><input name="fecha_nacimiento" type="date" defaultValue={saved.current.fecha_nacimiento || ''} style={S.input} /></Field>
              <div style={S.divider} />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#b91c3c', margin: '0 0 16px' }}>Cónyuge</h3>
              <Field label="¿Está casado(a) bajo sociedad conyugal?">
                <div style={{ display: 'flex', gap: 10 }}>
                  {[{ value: 'no', label: 'No' }, { value: 'si', label: 'Sí — sociedad conyugal' }].map(o => (
                    <button key={o.value} type="button" onClick={() => setTieneConyuge(o.value)}
                      style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${tieneConyuge === o.value ? '#b91c3c' : '#e5e7eb'}`, background: tieneConyuge === o.value ? '#fff0f3' : '#fff', color: tieneConyuge === o.value ? '#b91c3c' : '#6b7280', fontSize: 13, cursor: 'pointer' }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>
              {tieneConyuge === 'si' && (
                <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
                  <p style={{ margin: '0 0 14px', fontWeight: 700, fontSize: 13, color: '#b91c3c' }}>Datos del cónyuge</p>
                  <Field label="Nombre completo"><input type="text" placeholder="Nombre completo" value={conyuge.nombre} onChange={e => setConyuge(p => ({ ...p, nombre: e.target.value }))} style={S.input} /></Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Teléfono"><input type="tel" placeholder="10 dígitos" value={conyuge.telefono} onChange={e => setConyuge(p => ({ ...p, telefono: e.target.value }))} style={S.input} /></Field>
                    <Field label="Correo"><input type="email" placeholder="correo@ejemplo.com" value={conyuge.correo} onChange={e => setConyuge(p => ({ ...p, correo: e.target.value }))} style={S.input} /></Field>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="RFC"><input type="text" placeholder="XXXX000000XXX" value={conyuge.rfc} onChange={e => setConyuge(p => ({ ...p, rfc: e.target.value }))} style={S.input} /></Field>
                    <Field label="Tipo de identificación">
                      <select value={conyuge.tipo_id} onChange={e => setConyuge(p => ({ ...p, tipo_id: e.target.value }))} style={S.select}>
                        <option value="INE">INE</option><option value="Pasaporte">Pasaporte</option><option value="Cédula profesional">Cédula profesional</option>
                      </select>
                    </Field>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={S.title}>Datos de la compra</h2>
              <p style={S.desc}>Información sobre el inmueble y proceso de compra.</p>
              {errors.global && <div style={S.globalErr}>{errors.global}</div>}
              <Field label="Inmueble de interés" required error={errors.inmueble_interes}>
                <textarea name="inmueble_interes" rows={2} placeholder="Dirección o nombre del inmueble" defaultValue={saved.current.inmueble_interes || ''} style={{ ...S.input, resize: 'vertical', ...(errors.inmueble_interes ? S.inputErr : {}) }} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Precio pactado (MXN)" required error={errors.precio_pactado}>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>$</span>
                    <input name="precio_pactado" type="number" placeholder="0.00" defaultValue={saved.current.precio_pactado || ''} style={{ ...S.input, paddingLeft: 28, ...(errors.precio_pactado ? S.inputErr : {}) }} />
                  </div>
                </Field>
                <Field label="Fecha de apartado"><input name="fecha_apartado" type="date" defaultValue={saved.current.fecha_apartado || ''} style={S.input} /></Field>
              </div>
              <Field label="Asesor de ventas"><input name="asesor_ventas" type="text" placeholder="Nombre del asesor" defaultValue={saved.current.asesor_ventas || ''} style={S.input} /></Field>
              <Field label="Forma de pago">
                <select name="forma_pago" defaultValue={saved.current.forma_pago || 'Contado'} style={S.select}>
                  <option value="Contado">Contado</option>
                  <option value="Crédito hipotecario BBVA">Crédito hipotecario BBVA</option>
                  <option value="Crédito hipotecario Banorte">Crédito hipotecario Banorte</option>
                  <option value="Crédito hipotecario HSBC">Crédito hipotecario HSBC</option>
                  <option value="INFONAVIT">INFONAVIT</option>
                  <option value="FOVISSSTE">FOVISSSTE</option>
                  <option value="Mixto">Mixto (crédito + contado)</option>
                  <option value="Otro">Otro</option>
                </select>
              </Field>
              <Field label="Notaría"><input name="notaria" type="text" placeholder="Nombre o número de notaría" defaultValue={saved.current.notaria || ''} style={S.input} /></Field>
              <div style={S.divider} />
              <FileBox label="Identificación oficial (INE/Pasaporte)" hint="Toca para subir identificación" required file={docIdentificacion} error={errors.doc_identificacion} onFile={setDocIdentificacion} />
              <div style={S.privacy}>
                🔒 Al enviar este formulario, acepta nuestro{' '}
                <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: '#b91c3c' }}>Aviso de Privacidad</a>. Su información es confidencial.
              </div>
            </>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={S.successIcon}>✓</div>
              <h2 style={{ fontSize: 26, fontWeight: 800, color: '#4a4a4a', margin: '0 0 12px' }}>¡Registro enviado!</h2>
              <p style={{ color: '#7a7a7a', fontSize: 14, lineHeight: 1.6 }}>Recibimos su información. Un asesor se pondrá en contacto con usted para continuar con el proceso de compra.</p>
              {submitId && <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 16 }}>Folio: <strong style={{ color: '#b91c3c' }}>{submitId.slice(0, 8).toUpperCase()}</strong></p>}
              <div style={{ marginTop: 24, padding: '16px 20px', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, textAlign: 'left' }}>
                <p style={{ margin: 0, fontWeight: 700, color: '#374151', fontSize: 14 }}>¿Tiene alguna duda?</p>
                <p style={{ margin: '6px 0 0', color: '#7a7a7a', fontSize: 13 }}>Llámenos al <strong style={{ color: '#b91c3c' }}>222 257 3237</strong></p>
              </div>
            </div>
          )}

          {step < 3 && (
            <div style={S.btnRow}>
              {step > 1 && <button onClick={() => setStep(1)} style={S.btnBack} disabled={loading}>← Anterior</button>}
              <button onClick={next} disabled={loading} style={{ ...S.btnNext, opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Enviando...' : step === 2 ? 'Enviar registro' : 'Siguiente →'}
              </button>
            </div>
          )}
        </div>
        <footer style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 40 }}>
          © {new Date().getFullYear()} Emporio Inmobiliario · Puebla, México
        </footer>
      </div>
    </>
  )
}
