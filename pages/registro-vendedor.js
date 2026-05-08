import { useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const S = {
  page: { minHeight: '100vh', background: '#0F0F0F', fontFamily: "'DM Sans', sans-serif", color: '#E8E8E8', paddingBottom: 60 },
  header: { display: 'flex', justifyContent: 'center', padding: '28px 20px 0' },
  logo: { height: 48, objectFit: 'contain' },
  hero: { textAlign: 'center', padding: '28px 20px 12px' },
  heroTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 32, fontWeight: 700, color: '#FFFFFF', margin: '0 0 8px' },
  heroSub: { color: '#888', fontSize: 14, margin: 0 },
  progress: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 20px' },
  dot: { width: 32, height: 32, borderRadius: '50%', background: '#222', border: '2px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#555', flexShrink: 0 },
  dotActive: { background: '#C8973A', border: '2px solid #C8973A', color: '#000' },
  dotDone: { background: '#2A5C3F', border: '2px solid #2A5C3F', color: '#5EC98A' },
  line: { width: 40, height: 2, background: '#222', margin: '0 8px' },
  lineDone: { background: '#2A5C3F' },
  card: { maxWidth: 580, margin: '0 auto', background: '#161616', border: '1px solid #222', borderRadius: 16, padding: '32px 28px', marginLeft: 16, marginRight: 16 },
  title: { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 700, color: '#FFF', margin: '0 0 6px' },
  desc: { color: '#777', fontSize: 13, margin: '0 0 24px', lineHeight: 1.5 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#AAA', marginBottom: 6 },
  input: { width: '100%', background: '#1E1E1E', border: '1px solid #2E2E2E', borderRadius: 8, padding: '12px 14px', color: '#E8E8E8', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: "'DM Sans', sans-serif" },
  inputErr: { borderColor: '#8B3A3A' },
  select: { width: '100%', background: '#1E1E1E', border: '1px solid #2E2E2E', borderRadius: 8, padding: '12px 14px', color: '#E8E8E8', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' },
  radioBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid #2E2E2E', background: '#1E1E1E', color: '#888', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  radioBtnActive: { background: '#C8973A20', border: '1px solid #C8973A', color: '#C8973A' },
  fileBox: { border: '2px dashed #2E2E2E', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: '#1A1A1A' },
  fileBoxDone: { border: '2px dashed #2A5C3F', background: '#1A2E20' },
  fileBoxErr: { border: '2px dashed #8B3A3A' },
  divider: { height: 1, background: '#222', margin: '24px 0' },
  errMsg: { color: '#E07070', fontSize: 12, margin: '6px 0 0' },
  globalErr: { background: '#2A1A1A', border: '1px solid #8B3A3A', borderRadius: 8, padding: '12px 16px', color: '#E07070', fontSize: 14, marginBottom: 16 },
  privacy: { fontSize: 12, color: '#555', lineHeight: 1.6, marginTop: 20, padding: '14px', background: '#111', borderRadius: 8, border: '1px solid #1E1E1E' },
  btnRow: { display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' },
  btnBack: { padding: '12px 20px', borderRadius: 8, border: '1px solid #2E2E2E', background: 'transparent', color: '#888', fontSize: 14, cursor: 'pointer' },
  btnNext: { padding: '12px 28px', borderRadius: 8, border: 'none', background: '#C8973A', color: '#000', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  successIcon: { width: 64, height: 64, borderRadius: '50%', background: '#2A5C3F', color: '#5EC98A', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' },
  successTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color: '#FFF', margin: '0 0 12px', textAlign: 'center' },
}

const Field = ({ label, error, children, required }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={S.label}>{label}{required && <span style={{ color: '#C8973A' }}> *</span>}</label>
    {children}
    {error && <p style={S.errMsg}>{error}</p>}
  </div>
)

const RadioGroup = ({ value, onChange, options }) => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
    {options.map(o => (
      <button key={o.value} type="button" onClick={() => onChange(o.value)}
        style={{ ...S.radioBtn, ...(value === o.value ? S.radioBtnActive : {}) }}>
        {o.label}
      </button>
    ))}
  </div>
)

const FileBox = ({ label, hint, file, onFile, error, accept = '.pdf,.jpg,.jpeg,.png' }) => {
  const ref = useRef()
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={S.label}>{label} <span style={{ color: '#C8973A' }}>*</span></label>
      <div onClick={() => ref.current.click()}
        style={{ ...S.fileBox, ...(file ? S.fileBoxDone : {}), ...(error ? S.fileBoxErr : {}) }}>
        <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
          onChange={e => onFile(e.target.files[0])} />
        <span style={{ display: 'block', fontSize: 22, marginBottom: 6, color: file ? '#5EC98A' : '#C8973A' }}>
          {file ? '✓' : '↑'}
        </span>
        <span style={{ display: 'block', fontSize: 13, color: '#DDD', fontWeight: 500, marginBottom: 3 }}>
          {file ? file.name : hint}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: '#555' }}>
          {file ? 'Toca para cambiar' : 'PDF, JPG o PNG · máx 10 MB'}
        </span>
      </div>
      {error && <p style={S.errMsg}>{error}</p>}
    </div>
  )
}

export default function RegistroVendedor() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitId, setSubmitId] = useState(null)

  // Paso 1 — datos
  const [tipoPersona, setTipoPersona] = useState('fisica')
  const [libreGravamen, setLibreGravamen] = useState('si')
  const [tipoCopropiedad, setTipoCopropiedad] = useState('no') // 'no' | 'conyuge' | 'copropietario'
  const [numCopropietarios, setNumCopropietarios] = useState(1)
  const [copropietarios, setCopropietarios] = useState([
    { nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' },
    { nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' },
    { nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' },
  ])
  const setCop = (i, field, value) => setCopropietarios(prev => {
    const next = [...prev]; next[i] = { ...next[i], [field]: value }; return next
  })
  const formRef = useRef(null)
  const saved = useRef({})

  // Paso 2 — documentos
  const [files, setFiles] = useState({
    doc_identificacion: null,
    doc_comprobante_domicilio: null,
    doc_predial: null,
    doc_escritura: null,
  })

  const getVals = () => {
    const v = { ...saved.current }
    if (formRef.current) {
      formRef.current.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => {
        v[el.name] = el.value
      })
    }
    return v
  }

  const saveStep = () => {
    if (!formRef.current) return
    formRef.current.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => {
      saved.current[el.name] = el.value
    })
  }

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })

  const validateStep1 = () => {
    const v = getVals()
    const e = {}
    if (!v.nombre_propietario?.trim()) e.nombre_propietario = 'Requerido'
    if (!v.telefono_propietario?.trim()) e.telefono_propietario = 'Requerido'
    if (!v.correo_propietario?.trim()) e.correo_propietario = 'Requerido'
    if (!v.direccion_inmueble?.trim()) e.direccion_inmueble = 'Requerido'
    if (!v.precio_venta?.trim()) e.precio_venta = 'Requerido'
    if (tipoPersona === 'moral' && !v.razon_social?.trim()) e.razon_social = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const e = {}
    if (!files.doc_identificacion) e.doc_identificacion = 'Requerido'
    if (!files.doc_comprobante_domicilio) e.doc_comprobante_domicilio = 'Requerido'
    if (!files.doc_predial) e.doc_predial = 'Requerido'
    if (!files.doc_escritura) e.doc_escritura = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2) { handleSubmit(); return }
    saveStep()
    setStep(2)
  }

  const handleSubmit = async () => {
    if (!validateStep2()) return
    setLoading(true)
    try {
      const v = getVals()
      const payload = {
        tipo_operacion: 'venta',
        tipo_persona_propietario: tipoPersona,
        nombre_propietario: v.nombre_propietario,
        razon_social_propietario: v.razon_social,
        representante_legal_propietario: v.representante_legal,
        telefono_propietario: v.telefono_propietario,
        correo_propietario: v.correo_propietario,
        domicilio_propietario: v.domicilio_propietario,
        rfc_propietario: v.rfc_propietario,
        direccion_inmueble: v.direccion_inmueble,
        precio_venta: parseFloat(v.precio_venta) || null,
        descripcion_inmueble: v.descripcion_inmueble,
        libre_gravamen: libreGravamen === 'si',
        institucion_gravamen: libreGravamen === 'no' ? v.institucion_gravamen : null,
        tipo_copropiedad: tipoCopropiedad,
        // Copropietario 1
        ...(tipoCopropiedad !== 'no' && copropietarios[0].nombre ? {
          copropietario_1_nombre: copropietarios[0].nombre,
          copropietario_1_telefono: copropietarios[0].telefono,
          copropietario_1_correo: copropietarios[0].correo,
          copropietario_1_rfc: copropietarios[0].rfc,
          copropietario_1_tipo_id: copropietarios[0].tipo_id,
        } : {}),
        // Copropietario 2
        ...(tipoCopropiedad !== 'no' && numCopropietarios >= 2 && copropietarios[1].nombre ? {
          copropietario_2_nombre: copropietarios[1].nombre,
          copropietario_2_telefono: copropietarios[1].telefono,
          copropietario_2_correo: copropietarios[1].correo,
          copropietario_2_rfc: copropietarios[1].rfc,
          copropietario_2_tipo_id: copropietarios[1].tipo_id,
        } : {}),
        // Copropietario 3
        ...(tipoCopropiedad !== 'no' && numCopropietarios >= 3 && copropietarios[2].nombre ? {
          copropietario_3_nombre: copropietarios[2].nombre,
          copropietario_3_telefono: copropietarios[2].telefono,
          copropietario_3_correo: copropietarios[2].correo,
          copropietario_3_rfc: copropietarios[2].rfc,
          copropietario_3_tipo_id: copropietarios[2].tipo_id,
        } : {}),
      }

      const { data, error } = await supabase
        .from('propietarios_inmuebles')
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error

      // Subir documentos como base64
      const docUpdates = {}
      if (files.doc_identificacion) docUpdates.doc_identificacion_b64 = await fileToBase64(files.doc_identificacion)
      if (files.doc_comprobante_domicilio) docUpdates.doc_comprobante_domicilio_b64 = await fileToBase64(files.doc_comprobante_domicilio)
      if (files.doc_predial) docUpdates.doc_predial_b64 = await fileToBase64(files.doc_predial)
      if (files.doc_escritura) docUpdates.doc_escritura_b64 = await fileToBase64(files.doc_escritura)
      if (Object.keys(docUpdates).length > 0) {
        await supabase.from('propietarios_inmuebles').update(docUpdates).eq('id', data.id)
      }

      setSubmitId(data.id)
      setStep(3)
    } catch (err) {
      console.error(err)
      setErrors({ global: 'Ocurrió un error. Por favor intenta de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  const STEPS = [{ id: 1, label: 'Su inmueble' }, { id: 2, label: 'Documentos' }]

  return (
    <>
      <Head>
        <title>Registra tu inmueble en venta — Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>
      <div style={S.page}>
        <header style={S.header}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={S.logo} />
        </header>
        <div style={S.hero}>
          <h1 style={S.heroTitle}>Vende con nosotros</h1>
          <p style={S.heroSub}>Emporio Inmobiliario — Puebla, México</p>
        </div>

        {/* Progress */}
        {step < 3 && (
          <div style={S.progress}>
            {STEPS.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ ...S.dot, ...(step === s.id ? S.dotActive : step > s.id ? S.dotDone : {}) }}>
                    {step > s.id ? '✓' : s.id}
                  </div>
                  <span style={{ fontSize: 10, color: step === s.id ? '#C8973A' : '#555' }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ ...S.line, ...(step > s.id ? S.lineDone : {}), marginBottom: 16 }} />
                )}
              </div>
            ))}
          </div>
        )}

        <div style={S.card} ref={formRef}>

          {/* PASO 1 */}
          {step === 1 && (
            <>
              <h2 style={S.title}>Datos del propietario e inmueble</h2>
              <p style={S.desc}>Esta información es confidencial y se usará para el contrato de promoción.</p>

              <Field label="Tipo de propietario">
                <RadioGroup value={tipoPersona} onChange={setTipoPersona} options={[
                  { value: 'fisica', label: 'Persona física' },
                  { value: 'moral', label: 'Persona moral' },
                ]} />
              </Field>

              {tipoPersona === 'moral' && (
                <>
                  <Field label="Razón social" error={errors.razon_social} required>
                    <input name="razon_social" type="text" placeholder="Nombre de la empresa"
                      defaultValue={saved.current.razon_social || ''}
                      style={{ ...S.input, ...(errors.razon_social ? S.inputErr : {}) }} />
                  </Field>
                  <Field label="Representante legal">
                    <input name="representante_legal" type="text" placeholder="Nombre del representante"
                      defaultValue={saved.current.representante_legal || ''}
                      style={S.input} />
                  </Field>
                </>
              )}

              <Field label="Nombre completo del propietario" required error={errors.nombre_propietario}>
                <input name="nombre_propietario" type="text" placeholder="Como aparece en su identificación"
                  defaultValue={saved.current.nombre_propietario || ''}
                  style={{ ...S.input, ...(errors.nombre_propietario ? S.inputErr : {}) }} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Teléfono" required error={errors.telefono_propietario}>
                  <input name="telefono_propietario" type="tel" placeholder="10 dígitos"
                    defaultValue={saved.current.telefono_propietario || ''}
                    style={{ ...S.input, ...(errors.telefono_propietario ? S.inputErr : {}) }} />
                </Field>
                <Field label="Correo electrónico" required error={errors.correo_propietario}>
                  <input name="correo_propietario" type="email" placeholder="correo@ejemplo.com"
                    defaultValue={saved.current.correo_propietario || ''}
                    style={{ ...S.input, ...(errors.correo_propietario ? S.inputErr : {}) }} />
                </Field>
              </div>
              <Field label="Domicilio del propietario">
                <textarea name="domicilio_propietario" rows={2} placeholder="Calle, número, colonia, ciudad"
                  defaultValue={saved.current.domicilio_propietario || ''}
                  style={{ ...S.input, resize: 'vertical' }} />
              </Field>
              <Field label="RFC">
                <input name="rfc_propietario" type="text" placeholder="XXXX000000XXX"
                  defaultValue={saved.current.rfc_propietario || ''}
                  style={S.input} />
              </Field>

              <div style={S.divider} />
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: '#C8973A', margin: '0 0 16px' }}>Datos del inmueble</h3>

              <Field label="Dirección completa del inmueble" required error={errors.direccion_inmueble}>
                <textarea name="direccion_inmueble" rows={3} placeholder="Calle, número, colonia, municipio, estado"
                  defaultValue={saved.current.direccion_inmueble || ''}
                  style={{ ...S.input, resize: 'vertical', ...(errors.direccion_inmueble ? S.inputErr : {}) }} />
              </Field>
              <Field label="Precio de venta (MXN)" required error={errors.precio_venta}>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#666' }}>$</span>
                  <input name="precio_venta" type="number" placeholder="0.00"
                    defaultValue={saved.current.precio_venta || ''}
                    style={{ ...S.input, paddingLeft: 28, ...(errors.precio_venta ? S.inputErr : {}) }} />
                </div>
              </Field>
              <Field label="Descripción del inmueble">
                <textarea name="descripcion_inmueble" rows={3} placeholder="Recámaras, baños, m², características especiales..."
                  defaultValue={saved.current.descripcion_inmueble || ''}
                  style={{ ...S.input, resize: 'vertical' }} />
              </Field>
              <Field label="¿El inmueble está libre de gravamen?">
                <RadioGroup value={libreGravamen} onChange={setLibreGravamen} options={[
                  { value: 'si', label: 'Sí, libre de gravamen' },
                  { value: 'no', label: 'No, tiene hipoteca' },
                ]} />
              </Field>
              {libreGravamen === 'no' && (
                <Field label="¿Con qué institución tiene el gravamen?">
                  <input name="institucion_gravamen" type="text" placeholder="Ej: BBVA, INFONAVIT, Scotiabank..."
                    defaultValue={saved.current.institucion_gravamen || ''}
                    style={S.input} />
                </Field>
              )}

              <div style={S.divider} />
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: '#C8973A', margin: '0 0 16px' }}>
                Copropietarios o cónyuge
              </h3>
              <Field label="¿Hay copropietarios o cónyuge con sociedad conyugal?">
                <RadioGroup value={tipoCopropiedad} onChange={setTipoCopropiedad} options={[
                  { value: 'no', label: 'No, solo yo' },
                  { value: 'conyuge', label: 'Sí — cónyuge (sociedad conyugal)' },
                  { value: 'copropietario', label: 'Sí — copropietario(s)' },
                ]} />
              </Field>

              {tipoCopropiedad !== 'no' && (
                <>
                  {tipoCopropiedad === 'copropietario' && (
                    <Field label="¿Cuántos copropietarios?">
                      <RadioGroup value={String(numCopropietarios)} onChange={v => setNumCopropietarios(Number(v))} options={[
                        { value: '1', label: '1' },
                        { value: '2', label: '2' },
                        { value: '3', label: '3' },
                      ]} />
                    </Field>
                  )}

                  {Array.from({ length: tipoCopropiedad === 'conyuge' ? 1 : numCopropietarios }, (_, i) => (
                    <div key={i} style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
                      <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 13, color: '#C8973A' }}>
                        {tipoCopropiedad === 'conyuge' ? 'Datos del cónyuge' : `Copropietario ${i + 1}`}
                      </p>
                      <Field label="Nombre completo">
                        <input type="text" placeholder="Nombre completo" value={copropietarios[i].nombre}
                          onChange={e => setCop(i, 'nombre', e.target.value)} style={S.input} />
                      </Field>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Field label="Teléfono">
                          <input type="tel" placeholder="10 dígitos" value={copropietarios[i].telefono}
                            onChange={e => setCop(i, 'telefono', e.target.value)} style={S.input} />
                        </Field>
                        <Field label="Correo">
                          <input type="email" placeholder="correo@ejemplo.com" value={copropietarios[i].correo}
                            onChange={e => setCop(i, 'correo', e.target.value)} style={S.input} />
                        </Field>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Field label="RFC">
                          <input type="text" placeholder="XXXX000000XXX" value={copropietarios[i].rfc}
                            onChange={e => setCop(i, 'rfc', e.target.value)} style={S.input} />
                        </Field>
                        <Field label="Tipo de identificación">
                          <select value={copropietarios[i].tipo_id}
                            onChange={e => setCop(i, 'tipo_id', e.target.value)} style={S.select}>
                            <option value="INE">INE</option>
                            <option value="Pasaporte">Pasaporte</option>
                            <option value="Cédula profesional">Cédula profesional</option>
                          </select>
                        </Field>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* PASO 2 */}
          {step === 2 && (
            <>
              <h2 style={S.title}>Documentos requeridos</h2>
              <p style={S.desc}>Suba una foto clara o PDF de cada documento. Todos son obligatorios.</p>

              {errors.global && <div style={S.globalErr}>{errors.global}</div>}

              <FileBox label="Identificación oficial (INE/Pasaporte)" hint="Toca para subir identificación"
                file={files.doc_identificacion} error={errors.doc_identificacion}
                onFile={f => setFiles(p => ({ ...p, doc_identificacion: f }))} />

              <FileBox label="Comprobante de domicilio del inmueble (reciente)" hint="Toca para subir comprobante"
                file={files.doc_comprobante_domicilio} error={errors.doc_comprobante_domicilio}
                onFile={f => setFiles(p => ({ ...p, doc_comprobante_domicilio: f }))} />

              <FileBox label="Última boleta de predial (año en curso)" hint="Toca para subir predial"
                file={files.doc_predial} error={errors.doc_predial}
                onFile={f => setFiles(p => ({ ...p, doc_predial: f }))} />

              <FileBox label="Copia de escritura" hint="Toca para subir escritura"
                file={files.doc_escritura} error={errors.doc_escritura}
                onFile={f => setFiles(p => ({ ...p, doc_escritura: f }))} />

              <div style={S.privacy}>
                🔒 Al enviar este formulario, acepta nuestro{' '}
                <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: '#C8973A' }}>
                  Aviso de Privacidad
                </a>. Su información es confidencial.
              </div>
            </>
          )}

          {/* PASO 3 — Éxito */}
          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={S.successIcon}>✓</div>
              <h2 style={S.successTitle}>¡Registro enviado!</h2>
              <p style={{ color: '#888', fontSize: 14, lineHeight: 1.6 }}>
                Recibimos los datos de su inmueble. En breve nos pondremos en contacto para iniciar la promoción de venta.
              </p>
              {submitId && (
                <p style={{ color: '#888', fontSize: 13, marginTop: 16 }}>
                  Folio: <strong style={{ color: '#C8973A' }}>{submitId.slice(0, 8).toUpperCase()}</strong>
                </p>
              )}
              <div style={{ marginTop: 24, padding: '16px 20px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 10, textAlign: 'left' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#fff', fontSize: 14 }}>¿Tiene alguna duda?</p>
                <p style={{ margin: '6px 0 0', color: '#aaa', fontSize: 13 }}>
                  Llámenos al <strong style={{ color: '#C8973A' }}>222 257 3237</strong>
                </p>
              </div>
            </div>
          )}

          {/* Botones */}
          {step < 3 && (
            <div style={S.btnRow}>
              {step > 1 && (
                <button onClick={() => setStep(1)} style={S.btnBack} disabled={loading}>← Anterior</button>
              )}
              <button onClick={next} disabled={loading}
                style={{ ...S.btnNext, opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Enviando...' : step === 2 ? 'Enviar registro' : 'Siguiente →'}
              </button>
            </div>
          )}
        </div>

        <footer style={{ textAlign: 'center', color: '#333', fontSize: 12, marginTop: 40 }}>
          © {new Date().getFullYear()} Emporio Inmobiliario · Puebla, México
        </footer>
      </div>
    </>
  )
}
