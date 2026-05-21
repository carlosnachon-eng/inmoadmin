import { useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const Field = ({ label, error, children, required }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
      {label}{required && <span style={{ color: '#b91c3c' }}> *</span>}
    </label>
    {children}
    {error && <p style={{ color: '#b91c3c', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{error}</p>}
  </div>
)

const Input = (props) => (
  <input {...props} style={{ width: '100%', background: '#fff', border: `1px solid ${props.error ? '#b91c3c' : '#e5e7eb'}`, borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', ...props.style }}
    onFocus={e => e.target.style.borderColor = '#b91c3c'}
    onBlur={e => e.target.style.borderColor = props.error ? '#b91c3c' : '#e5e7eb'} />
)

const Sel = ({ children, ...props }) => (
  <select {...props} style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
    {children}
  </select>
)

const RadioGroup = ({ value, onChange, options }) => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
    {options.map(o => (
      <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
        style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${String(value) === String(o.value) ? '#b91c3c' : '#e5e7eb'}`, background: String(value) === String(o.value) ? '#fff0f3' : '#fff', color: String(value) === String(o.value) ? '#b91c3c' : '#6b7280', fontSize: 13, cursor: 'pointer' }}>
        {o.label}
      </button>
    ))}
  </div>
)

const SectionTitle = ({ title }) => (
  <div style={{ margin: '28px 0 18px', paddingBottom: 12, borderBottom: '2px solid #b91c3c' }}>
    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#4a4a4a' }}>{title}</h3>
  </div>
)

const FileBox = ({ label, hint, file, onFile, error }) => {
  const ref = useRef()
  return (
    <Field label={label} error={error} required>
      <div onClick={() => ref.current.click()}
        style={{ border: `2px dashed ${error ? '#b91c3c' : file ? '#b91c3c' : '#e5e7eb'}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: file ? '#fff0f3' : '#fafafa' }}>
        <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />
        <span style={{ display: 'block', fontSize: 22, marginBottom: 6, color: file ? '#065f46' : '#b91c3c' }}>{file ? '✓' : '↑'}</span>
        <span style={{ display: 'block', fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 3 }}>{file ? file.name : hint}</span>
        <span style={{ display: 'block', fontSize: 11, color: '#9ca3af' }}>{file ? 'Toca para cambiar' : 'PDF, JPG o PNG · máx 10 MB'}</span>
      </div>
    </Field>
  )
}

export default function RegistroVendedor() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitId, setSubmitId] = useState(null)
  const [tipoPersona, setTipoPersona] = useState('fisica')
  const [libreGravamen, setLibreGravamen] = useState('si')
  const [tipoCopropiedad, setTipoCopropiedad] = useState('no')
  const [numCopropietarios, setNumCopropietarios] = useState(1)
  const [copropietarios, setCopropietarios] = useState([
    { nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' },
    { nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' },
    { nombre: '', telefono: '', correo: '', rfc: '', tipo_id: 'INE' },
  ])
  const [files, setFiles] = useState({ doc_identificacion: null, doc_comprobante_domicilio: null, doc_predial: null, doc_escritura: null })
  const formRef = useRef(null)
  const saved = useRef({})

  const setCop = (i, field, value) => setCopropietarios(prev => { const next = [...prev]; next[i] = { ...next[i], [field]: value }; return next })

  const getVals = () => {
    const v = { ...saved.current }
    if (formRef.current) formRef.current.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => { v[el.name] = el.value })
    return v
  }
  const saveStep = () => { if (!formRef.current) return; formRef.current.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => { saved.current[el.name] = el.value }) }
  const fileToBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })

  const validateStep1 = () => {
    const v = getVals(); const e = {}
    if (!v.nombre_propietario?.trim()) e.nombre_propietario = 'Requerido'
    if (!v.telefono_propietario?.trim()) e.telefono_propietario = 'Requerido'
    if (!v.correo_propietario?.trim()) e.correo_propietario = 'Requerido'
    if (!v.direccion_inmueble?.trim()) e.direccion_inmueble = 'Requerido'
    if (!v.precio_venta?.trim()) e.precio_venta = 'Requerido'
    if (tipoPersona === 'moral' && !v.razon_social?.trim()) e.razon_social = 'Requerido'
    setErrors(e); return Object.keys(e).length === 0
  }
  const validateStep2 = () => {
    const e = {}
    if (!files.doc_identificacion) e.doc_identificacion = 'Requerido'
    if (!files.doc_comprobante_domicilio) e.doc_comprobante_domicilio = 'Requerido'
    if (!files.doc_predial) e.doc_predial = 'Requerido'
    if (!files.doc_escritura) e.doc_escritura = 'Requerido'
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
        tipo_operacion: 'venta', tipo_persona_propietario: tipoPersona,
        nombre_propietario: v.nombre_propietario, razon_social_propietario: v.razon_social,
        representante_legal_propietario: v.representante_legal,
        telefono_propietario: v.telefono_propietario, correo_propietario: v.correo_propietario,
        domicilio_propietario: v.domicilio_propietario, rfc_propietario: v.rfc_propietario,
        direccion_inmueble: v.direccion_inmueble, precio_venta: parseFloat(v.precio_venta) || null,
        descripcion_inmueble: v.descripcion_inmueble, libre_gravamen: libreGravamen === 'si',
        institucion_gravamen: libreGravamen === 'no' ? v.institucion_gravamen : null,
        tipo_copropiedad: tipoCopropiedad,
        ...(tipoCopropiedad !== 'no' && copropietarios[0].nombre ? { copropietario_1_nombre: copropietarios[0].nombre, copropietario_1_telefono: copropietarios[0].telefono, copropietario_1_correo: copropietarios[0].correo, copropietario_1_rfc: copropietarios[0].rfc, copropietario_1_tipo_id: copropietarios[0].tipo_id } : {}),
        ...(tipoCopropiedad !== 'no' && numCopropietarios >= 2 && copropietarios[1].nombre ? { copropietario_2_nombre: copropietarios[1].nombre, copropietario_2_telefono: copropietarios[1].telefono, copropietario_2_correo: copropietarios[1].correo, copropietario_2_rfc: copropietarios[1].rfc, copropietario_2_tipo_id: copropietarios[1].tipo_id } : {}),
        ...(tipoCopropiedad !== 'no' && numCopropietarios >= 3 && copropietarios[2].nombre ? { copropietario_3_nombre: copropietarios[2].nombre, copropietario_3_telefono: copropietarios[2].telefono, copropietario_3_correo: copropietarios[2].correo, copropietario_3_rfc: copropietarios[2].rfc, copropietario_3_tipo_id: copropietarios[2].tipo_id } : {}),
      }
      const { data, error } = await supabase.from('propietarios_inmuebles').insert(payload).select('id').single()
      if (error) throw error
      const docUpdates = {}
      if (files.doc_identificacion) docUpdates.doc_identificacion_b64 = await fileToBase64(files.doc_identificacion)
      if (files.doc_comprobante_domicilio) docUpdates.doc_comprobante_domicilio_b64 = await fileToBase64(files.doc_comprobante_domicilio)
      if (files.doc_predial) docUpdates.doc_predial_b64 = await fileToBase64(files.doc_predial)
      if (files.doc_escritura) docUpdates.doc_escritura_b64 = await fileToBase64(files.doc_escritura)
      if (Object.keys(docUpdates).length > 0) await supabase.from('propietarios_inmuebles').update(docUpdates).eq('id', data.id)
      setSubmitId(data.id); setStep(3)
    } catch (err) { console.error(err); setErrors({ global: 'Ocurrió un error. Por favor intenta de nuevo.' }) }
    finally { setLoading(false) }
  }

  const STEPS = ['Su inmueble', 'Documentos']

  return (
    <>
      <Head>
        <title>Vende con nosotros — Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#f8f8f8', fontFamily: 'system-ui, sans-serif', paddingBottom: 60 }}>

        {/* Header */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 20px' }}>
          <div style={{ maxWidth: 580, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 36, objectFit: 'contain' }} />
            {step < 3 && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#b91c3c' }}>Vende con nosotros</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>Paso {step} de {STEPS.length}</p>
              </div>
            )}
          </div>
        </div>
        {step < 3 && (
          <div style={{ background: '#f3f4f6', height: 4 }}>
            <div style={{ background: '#b91c3c', height: 4, width: `${(step / STEPS.length) * 100}%`, transition: 'width 0.3s ease' }} />
          </div>
        )}

        {step < 3 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '20px 20px 0' }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: step > i + 1 ? '#065f46' : step === i + 1 ? '#b91c3c' : '#f3f4f6', color: step >= i + 1 ? '#fff' : '#9ca3af' }}>
                  {step > i + 1 ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 11, color: step === i + 1 ? '#b91c3c' : '#9ca3af', fontWeight: step === i + 1 ? 700 : 400 }}>{s}</span>
                {i < STEPS.length - 1 && <div style={{ width: 20, height: 1, background: '#e5e7eb', margin: '0 4px' }} />}
              </div>
            ))}
          </div>
        )}

        <div style={{ maxWidth: 580, margin: '20px auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '28px 24px', marginLeft: 16, marginRight: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }} ref={formRef}>

          {/* PASO 1 */}
          {step === 1 && (
            <>
              <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#4a4a4a' }}>Datos del propietario e inmueble</h2>
              <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af' }}>Esta información es confidencial y se usará para el contrato de promoción.</p>

              <Field label="Tipo de propietario">
                <RadioGroup value={tipoPersona} onChange={setTipoPersona} options={[{ value: 'fisica', label: 'Persona física' }, { value: 'moral', label: 'Persona moral' }]} />
              </Field>
              {tipoPersona === 'moral' && (
                <>
                  <Field label="Razón social" required error={errors.razon_social}>
                    <Input name="razon_social" placeholder="Nombre de la empresa" defaultValue={saved.current.razon_social || ''} error={errors.razon_social} />
                  </Field>
                  <Field label="Representante legal">
                    <Input name="representante_legal" placeholder="Nombre del representante" defaultValue={saved.current.representante_legal || ''} />
                  </Field>
                </>
              )}
              <Field label="Nombre completo del propietario" required error={errors.nombre_propietario}>
                <Input name="nombre_propietario" placeholder="Como aparece en su identificación" defaultValue={saved.current.nombre_propietario || ''} error={errors.nombre_propietario} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Teléfono" required error={errors.telefono_propietario}>
                  <Input name="telefono_propietario" type="tel" placeholder="10 dígitos" defaultValue={saved.current.telefono_propietario || ''} error={errors.telefono_propietario} />
                </Field>
                <Field label="Correo" required error={errors.correo_propietario}>
                  <Input name="correo_propietario" type="email" placeholder="correo@ejemplo.com" defaultValue={saved.current.correo_propietario || ''} error={errors.correo_propietario} />
                </Field>
              </div>
              <Field label="Domicilio del propietario">
                <textarea name="domicilio_propietario" rows={2} placeholder="Calle, número, colonia, ciudad" defaultValue={saved.current.domicilio_propietario || ''}
                  style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </Field>
              <Field label="RFC">
                <Input name="rfc_propietario" placeholder="XXXX000000XXX" defaultValue={saved.current.rfc_propietario || ''} />
              </Field>

              <SectionTitle title="Datos del inmueble" />
              <Field label="Dirección completa del inmueble" required error={errors.direccion_inmueble}>
                <textarea name="direccion_inmueble" rows={3} placeholder="Calle, número, colonia, municipio, estado" defaultValue={saved.current.direccion_inmueble || ''}
                  style={{ width: '100%', background: '#fff', border: `1px solid ${errors.direccion_inmueble ? '#b91c3c' : '#e5e7eb'}`, borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
                {errors.direccion_inmueble && <p style={{ color: '#b91c3c', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{errors.direccion_inmueble}</p>}
              </Field>
              <Field label="Precio de venta (MXN)" required error={errors.precio_venta}>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>$</span>
                  <Input name="precio_venta" type="number" placeholder="0.00" style={{ paddingLeft: 28 }} defaultValue={saved.current.precio_venta || ''} error={errors.precio_venta} />
                </div>
              </Field>
              <Field label="Descripción del inmueble">
                <textarea name="descripcion_inmueble" rows={3} placeholder="Recámaras, baños, m², características especiales..." defaultValue={saved.current.descripcion_inmueble || ''}
                  style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </Field>
              <Field label="¿El inmueble está libre de gravamen?">
                <RadioGroup value={libreGravamen} onChange={setLibreGravamen} options={[{ value: 'si', label: 'Sí, libre de gravamen' }, { value: 'no', label: 'No, tiene hipoteca' }]} />
              </Field>
              {libreGravamen === 'no' && (
                <Field label="¿Con qué institución tiene el gravamen?">
                  <Input name="institucion_gravamen" placeholder="Ej: BBVA, INFONAVIT, Scotiabank..." defaultValue={saved.current.institucion_gravamen || ''} />
                </Field>
              )}

              <SectionTitle title="Copropietarios o cónyuge" />
              <Field label="¿Hay copropietarios o cónyuge con sociedad conyugal?">
                <RadioGroup value={tipoCopropiedad} onChange={setTipoCopropiedad} options={[
                  { value: 'no', label: 'No, solo yo' },
                  { value: 'conyuge', label: 'Cónyuge (sociedad conyugal)' },
                  { value: 'copropietario', label: 'Copropietario(s)' },
                ]} />
              </Field>
              {tipoCopropiedad !== 'no' && (
                <>
                  {tipoCopropiedad === 'copropietario' && (
                    <Field label="¿Cuántos copropietarios?">
                      <RadioGroup value={String(numCopropietarios)} onChange={v => setNumCopropietarios(Number(v))} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
                    </Field>
                  )}
                  {Array.from({ length: tipoCopropiedad === 'conyuge' ? 1 : numCopropietarios }, (_, i) => (
                    <div key={i} style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
                      <p style={{ margin: '0 0 14px', fontWeight: 700, fontSize: 13, color: '#b91c3c' }}>{tipoCopropiedad === 'conyuge' ? 'Datos del cónyuge' : `Copropietario ${i + 1}`}</p>
                      <Field label="Nombre completo"><input type="text" placeholder="Nombre completo" value={copropietarios[i].nombre} onChange={e => setCop(i, 'nombre', e.target.value)} style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} /></Field>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Field label="Teléfono"><input type="tel" placeholder="10 dígitos" value={copropietarios[i].telefono} onChange={e => setCop(i, 'telefono', e.target.value)} style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} /></Field>
                        <Field label="Correo"><input type="email" placeholder="correo@ejemplo.com" value={copropietarios[i].correo} onChange={e => setCop(i, 'correo', e.target.value)} style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} /></Field>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Field label="RFC"><input type="text" placeholder="XXXX000000XXX" value={copropietarios[i].rfc} onChange={e => setCop(i, 'rfc', e.target.value)} style={{ width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} /></Field>
                        <Field label="Tipo de identificación">
                          <Sel value={copropietarios[i].tipo_id} onChange={e => setCop(i, 'tipo_id', e.target.value)}>
                            <option value="INE">INE</option><option value="Pasaporte">Pasaporte</option><option value="Cédula profesional">Cédula profesional</option>
                          </Sel>
                        </Field>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* PASO 2 — Documentos */}
          {step === 2 && (
            <>
              <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#4a4a4a' }}>Documentos requeridos</h2>
              <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af' }}>Suba una foto clara o PDF de cada documento. Todos son obligatorios.</p>
              {errors.global && <div style={{ background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#b91c3c', fontSize: 14, marginBottom: 16, fontWeight: 600 }}>{errors.global}</div>}
              <FileBox label="Identificación oficial (INE/Pasaporte)" hint="Toca para subir identificación" file={files.doc_identificacion} error={errors.doc_identificacion} onFile={f => setFiles(p => ({ ...p, doc_identificacion: f }))} />
              <FileBox label="Comprobante de domicilio del inmueble (reciente)" hint="Toca para subir comprobante" file={files.doc_comprobante_domicilio} error={errors.doc_comprobante_domicilio} onFile={f => setFiles(p => ({ ...p, doc_comprobante_domicilio: f }))} />
              <FileBox label="Última boleta de predial (año en curso)" hint="Toca para subir predial" file={files.doc_predial} error={errors.doc_predial} onFile={f => setFiles(p => ({ ...p, doc_predial: f }))} />
              <FileBox label="Copia de escritura" hint="Toca para subir escritura" file={files.doc_escritura} error={errors.doc_escritura} onFile={f => setFiles(p => ({ ...p, doc_escritura: f }))} />
              <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6, marginTop: 20, padding: '14px', background: '#f8f8f8', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                🔒 Al enviar este formulario, acepta nuestro{' '}
                <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: '#b91c3c' }}>Aviso de Privacidad</a>. Su información es confidencial.
              </div>
            </>
          )}

          {/* PASO 3 — Éxito */}
          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fff0f3', color: '#b91c3c', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>✓</div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: '#4a4a4a', margin: '0 0 12px' }}>¡Registro enviado!</h2>
              <p style={{ color: '#9ca3af', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>Recibimos los datos de su inmueble. En breve nos pondremos en contacto para iniciar la promoción de venta.</p>
              {submitId && <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 20 }}>Folio: <strong style={{ color: '#b91c3c' }}>{submitId.slice(0, 8).toUpperCase()}</strong></p>}
              <div style={{ padding: '16px 20px', background: '#f8f8f8', border: '1px solid #e5e7eb', borderRadius: 10, textAlign: 'left' }}>
                <p style={{ margin: 0, fontWeight: 700, color: '#374151', fontSize: 14 }}>¿Tiene alguna duda?</p>
                <p style={{ margin: '6px 0 0', color: '#9ca3af', fontSize: 13 }}>Llámenos al <strong style={{ color: '#b91c3c' }}>222 257 3237</strong></p>
              </div>
            </div>
          )}

          {step < 3 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              {step > 1 && <button onClick={() => setStep(1)} disabled={loading} style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>← Anterior</button>}
              <button onClick={next} disabled={loading} style={{ padding: '12px 28px', borderRadius: 8, border: 'none', background: '#b91c3c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Enviando...' : step === 2 ? 'Enviar registro' : 'Siguiente →'}
              </button>
            </div>
          )}
        </div>

        <footer style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 20 }}>
          © {new Date().getFullYear()} Emporio Inmobiliario · Puebla, México
        </footer>
      </div>
    </>
  )
}
