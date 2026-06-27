import { useEffect, useState, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
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

const SectionTitle = ({ title, subtitle }) => (
  <div style={{ margin: '28px 0 18px', paddingBottom: 12, borderBottom: '2px solid #b91c3c' }}>
    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#4a4a4a' }}>{title}</h3>
    {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>{subtitle}</p>}
  </div>
)

const PartnerBanner = ({ branding }) => {
  if (!branding?.agency) return null
  const color = branding.agency.brand_color || '#b91c3c'
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
      {branding.agency.logo_url ? (
        <img src={branding.agency.logo_url} alt={branding.agency.nombre_comercial} style={{ width: 54, height: 54, borderRadius: 12, objectFit: 'contain', border: '1px solid #e5e7eb', background: '#fff' }} />
      ) : (
        <div style={{ width: 54, height: 54, borderRadius: 12, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900 }}>
          {branding.agency.nombre_comercial?.[0] || 'P'}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, color, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8 }}>Registro enviado por {branding.agency.nombre_comercial}</p>
        <p style={{ margin: '4px 0 0', color: '#374151', fontSize: 13, lineHeight: 1.45 }}>En alianza con Emporio Blindaje Legal. Nuestro equipo juridico revisara la documentacion del inmueble.</p>
      </div>
    </div>
  )
}

const uploadDoc = async (file, folder, fileName) => {
  const ext = file.name.split('.').pop()
  const path = `${folder}/${fileName}.${ext}`
  const { error } = await supabase.storage.from('poliza-docs').upload(path, file, { upsert: true })
  if (error) throw error
  return path
}

export default function RegistroPropietario() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitId, setSubmitId] = useState(null)
  const [formaPago, setFormaPago] = useState('transferencia')
  const [tipoInmueble, setTipoInmueble] = useState('habitacional_sin_muebles')
  const [mantenimientoIncluido, setMantenimientoIncluido] = useState(false)
  const [mascotasPermitidas, setMascotasPermitidas] = useState('no')
  const [reglamento, setReglamento] = useState('no')
  const [contratoAdmin, setContratoAdmin] = useState(false)
  const [files, setFiles] = useState({ doc_identificacion: null, doc_comprobante_domicilio: null, doc_predial: null })
  const [partnerBranding, setPartnerBranding] = useState(null)
  const formRef = useRef(null)
  const savedValues = useRef({})
  const fileRef1 = useRef(); const fileRef2 = useRef(); const fileRef3 = useRef()

  const getValues = () => {
    const data = { ...savedValues.current }
    if (formRef.current) formRef.current.querySelectorAll('input[name], textarea[name]').forEach(el => { data[el.name] = el.value })
    return data
  }
  const saveCurrentStep = () => { if (!formRef.current) return; formRef.current.querySelectorAll('input[name], textarea[name]').forEach(el => { savedValues.current[el.name] = el.value }) }
  const handleFile = (field, file) => { setFiles(f => ({ ...f, [field]: file })); setErrors(e => ({ ...e, [field]: undefined })) }

  useEffect(() => {
    if (!router.isReady) return
    const { partner, operacion } = router.query
    if (!partner || !operacion) return
    fetch(`/api/partners/public-branding?partner=${encodeURIComponent(partner)}&operacion=${encodeURIComponent(operacion)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setPartnerBranding(data)
        savedValues.current = {
          ...savedValues.current,
          nombre_propietario: savedValues.current.nombre_propietario || data.operation?.nombre_propietario || '',
          direccion_inmueble: savedValues.current.direccion_inmueble || data.operation?.direccion_inmueble || '',
          monto_renta: savedValues.current.monto_renta || (data.operation?.monto_renta ? String(data.operation.monto_renta) : ''),
        }
      })
      .catch(() => {})
  }, [router.isReady, router.query])

  const validateStep1 = () => {
    const v = getValues(); const e = {}
    if (!v.nombre_propietario?.trim()) e.nombre_propietario = 'Requerido'
    if (!v.telefono_propietario?.trim()) e.telefono_propietario = 'Requerido'
    if (!v.correo_propietario?.trim()) e.correo_propietario = 'Requerido'
    if (!v.domicilio_propietario?.trim()) e.domicilio_propietario = 'Requerido'
    if (formaPago === 'transferencia' && !v.clabe?.trim()) e.clabe = 'Requerido para transferencia'
    setErrors(e); return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const v = getValues(); const e = {}
    if (!v.direccion_inmueble?.trim()) e.direccion_inmueble = 'Requerido'
    if (!v.monto_renta) e.monto_renta = 'Requerido'
    setErrors(e); return Object.keys(e).length === 0
  }

  const validateStep3 = () => {
    const e = {}
    if (!files.doc_identificacion) e.doc_identificacion = 'Sube tu identificación oficial'
    if (!files.doc_comprobante_domicilio) e.doc_comprobante_domicilio = 'Sube comprobante de domicilio'
    if (!files.doc_predial) e.doc_predial = 'Sube la boleta de predial'
    setErrors(e); return Object.keys(e).length === 0
  }

  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    if (step === 3) { handleSubmit(); return }
    saveCurrentStep(); setStep(s => s + 1)
  }

  const handleSubmit = async () => {
    if (!validateStep3()) return
    setLoading(true)
    try {
      const v = getValues()
      const payload = {
        nombre_propietario: v.nombre_propietario, telefono_propietario: v.telefono_propietario,
        correo_propietario: v.correo_propietario, domicilio_propietario: v.domicilio_propietario,
        rfc_propietario: v.rfc_propietario, clave_elector_propietario: v.clave_elector_propietario,
        forma_pago: formaPago, banco: v.banco, clabe: v.clabe, cuenta_bancaria: v.cuenta_bancaria,
        direccion_inmueble: v.direccion_inmueble, tipo_inmueble: tipoInmueble,
        monto_renta: parseFloat(v.monto_renta) || null, mantenimiento_incluido: mantenimientoIncluido,
        mascotas_permitidas: mascotasPermitidas, detalle_mascotas: v.detalle_mascotas,
        num_habitantes: parseInt(v.num_habitantes) || null, reglamento,
        permiso_mudanzas: v.permiso_mudanzas, contrato_administracion: contratoAdmin,
      }
      const { data, error } = await supabase.from('propietarios_inmuebles').insert(payload).select('id').single()
      if (error) throw error

      const id = data.id
      const folder = `propietarios/${id}`
      const docUpdates = {}

      const [pathId, pathComp, pathPred] = await Promise.all([
        files.doc_identificacion ? uploadDoc(files.doc_identificacion, folder, 'identificacion') : Promise.resolve(null),
        files.doc_comprobante_domicilio ? uploadDoc(files.doc_comprobante_domicilio, folder, 'comprobante_domicilio') : Promise.resolve(null),
        files.doc_predial ? uploadDoc(files.doc_predial, folder, 'predial') : Promise.resolve(null),
      ])

      if (pathId) docUpdates.doc_identificacion_b64 = pathId
      if (pathComp) docUpdates.doc_comprobante_domicilio_b64 = pathComp
      if (pathPred) docUpdates.doc_predial_b64 = pathPred

      if (Object.keys(docUpdates).length > 0) {
        await supabase.from('propietarios_inmuebles').update(docUpdates).eq('id', id)
      }

      if (router.query.partner && router.query.operacion) {
        fetch('/api/partners/link-submission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partner_agency_id: router.query.partner,
            partner_operation_id: router.query.operacion,
            tipo: 'propietario',
            record_id: id,
          }),
        }).catch(() => {})
      }

      setSubmitId(id); setStep(4)
    } catch (err) {
      console.error(err)
      setErrors({ global: 'Ocurrió un error al subir los documentos. Por favor intenta de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  const totalSteps = 3
  const STEPS = ['Sus datos', 'El inmueble', 'Documentos']

  const FileBox = ({ field, label, hint, fileRef }) => (
    <Field label={label} error={errors[field]}>
      <div onClick={() => fileRef.current.click()}
        style={{ border: `2px dashed ${errors[field] ? '#b91c3c' : files[field] ? '#b91c3c' : '#e5e7eb'}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: files[field] ? '#fff0f3' : '#fafafa' }}>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => handleFile(field, e.target.files[0])} />
        <span style={{ display: 'block', fontSize: 22, marginBottom: 6, color: files[field] ? '#065f46' : '#b91c3c' }}>{files[field] ? '✓' : '↑'}</span>
        <span style={{ display: 'block', fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 3 }}>{files[field] ? files[field].name : hint}</span>
        <span style={{ display: 'block', fontSize: 11, color: '#9ca3af' }}>{files[field] ? 'Toca para cambiar' : 'PDF, JPG o PNG · máx 50 MB'}</span>
      </div>
    </Field>
  )

  return (
    <>
      <Head>
        <title>Registra tu inmueble — Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#f8f8f8', fontFamily: 'system-ui, sans-serif', paddingBottom: 60 }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 20px' }}>
          <div style={{ maxWidth: 580, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 36, objectFit: 'contain' }} />
            {step < 4 && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#b91c3c' }}>Registra tu inmueble</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>Paso {step} de {totalSteps}</p>
              </div>
            )}
          </div>
        </div>
        {step < 4 && (<div style={{ background: '#f3f4f6', height: 4 }}><div style={{ background: '#b91c3c', height: 4, width: `${(step / totalSteps) * 100}%`, transition: 'width 0.3s ease' }} /></div>)}
        {step < 4 && (
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
        <div style={{ maxWidth: 580, margin: '20px auto', marginLeft: 16, marginRight: 16 }}>
          <PartnerBanner branding={partnerBranding} />
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '28px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }} ref={formRef}>
          {step === 1 && (<>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#4a4a4a' }}>Sus datos personales</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af' }}>Esta información aparecerá en su contrato de prestación de servicios.</p>
            <Field label="Nombre completo" required error={errors.nombre_propietario}><Input name="nombre_propietario" placeholder="Como aparece en su identificación oficial" error={errors.nombre_propietario} /></Field>
            <Field label="Teléfono de contacto" required error={errors.telefono_propietario}><Input name="telefono_propietario" type="tel" placeholder="10 dígitos" error={errors.telefono_propietario} /></Field>
            <Field label="Correo electrónico" required error={errors.correo_propietario}><Input name="correo_propietario" type="email" placeholder="correo@ejemplo.com" error={errors.correo_propietario} /></Field>
            <Field label="Domicilio particular" required error={errors.domicilio_propietario}>
              <textarea name="domicilio_propietario" placeholder="Calle, número, colonia, ciudad, estado" rows={3} style={{ width: '100%', background: '#fff', border: `1px solid ${errors.domicilio_propietario ? '#b91c3c' : '#e5e7eb'}`, borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              {errors.domicilio_propietario && <p style={{ color: '#b91c3c', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{errors.domicilio_propietario}</p>}
            </Field>
            <Field label="RFC"><Input name="rfc_propietario" placeholder="XXXX000000XXX" /></Field>
            <Field label="Clave de elector (INE)"><Input name="clave_elector_propietario" placeholder="Clave de elector" /></Field>
            <SectionTitle title="Datos para recibir su renta" />
            <Field label="Forma de pago preferida">
              <RadioGroup value={formaPago} onChange={setFormaPago} options={[{ value: 'transferencia', label: 'Transferencia bancaria' }, { value: 'efectivo', label: 'Efectivo' }]} />
            </Field>
            {formaPago === 'transferencia' && (<>
              <Field label="Banco"><Input name="banco" placeholder="Ej: BBVA, Banorte, HSBC..." /></Field>
              <Field label="CLABE interbancaria" required error={errors.clabe}><Input name="clabe" placeholder="18 dígitos" maxLength={18} error={errors.clabe} /></Field>
              <Field label="Número de cuenta"><Input name="cuenta_bancaria" placeholder="Opcional" /></Field>
            </>)}
          </>)}
          {step === 2 && (<>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#4a4a4a' }}>Datos del inmueble</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af' }}>Con esta información promocionaremos su propiedad.</p>
            <Field label="Dirección del inmueble" required error={errors.direccion_inmueble}>
              <textarea name="direccion_inmueble" placeholder="Calle, número, colonia, municipio, estado" rows={3} style={{ width: '100%', background: '#fff', border: `1px solid ${errors.direccion_inmueble ? '#b91c3c' : '#e5e7eb'}`, borderRadius: 8, padding: '11px 14px', color: '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              {errors.direccion_inmueble && <p style={{ color: '#b91c3c', fontSize: 12, margin: '6px 0 0', fontWeight: 600 }}>{errors.direccion_inmueble}</p>}
            </Field>
            <Field label="Tipo de inmueble">
              <RadioGroup value={tipoInmueble} onChange={setTipoInmueble} options={[{ value: 'habitacional_sin_muebles', label: 'Casa/Depto sin muebles' }, { value: 'habitacional_amueblada', label: 'Casa/Depto amueblada' }, { value: 'comercial', label: 'Local comercial' }]} />
            </Field>
            <Field label="Monto de renta mensual (MXN)" required error={errors.monto_renta}>
              <div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>$</span><Input name="monto_renta" type="number" placeholder="0.00" style={{ paddingLeft: 28 }} error={errors.monto_renta} /></div>
            </Field>
            <Field label="¿El mantenimiento está incluido en la renta?"><RadioGroup value={mantenimientoIncluido} onChange={setMantenimientoIncluido} options={[{ value: true, label: 'Sí, incluido' }, { value: false, label: 'No incluido' }]} /></Field>
            <Field label="¿Se permiten mascotas?"><RadioGroup value={mascotasPermitidas} onChange={setMascotasPermitidas} options={[{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }, { value: 'condicionado', label: 'Condicionado' }]} /></Field>
            {(mascotasPermitidas === 'si' || mascotasPermitidas === 'condicionado') && (<Field label="Especifique condiciones de mascotas"><Input name="detalle_mascotas" placeholder="Ej: Solo perros pequeños, sin gatos, etc." /></Field>)}
            <Field label="Número máximo de habitantes"><Input name="num_habitantes" type="number" placeholder="Ej: 4" /></Field>
            <Field label="¿Cuenta con reglamento de vecinos?"><RadioGroup value={reglamento} onChange={setReglamento} options={[{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }]} /></Field>
            <Field label="Condiciones para mudanza"><Input name="permiso_mudanzas" placeholder="Ej: Solo sábados 9am-5pm, avisar con 48 hrs..." /></Field>
            <SectionTitle title="Servicio de administración" subtitle="¿Desea que Emporio administre su inmueble? (cobranza, mantenimiento, reportes mensuales)" />
            <Field label="¿Contratar servicio de administración?"><RadioGroup value={contratoAdmin} onChange={setContratoAdmin} options={[{ value: true, label: 'Sí, me interesa' }, { value: false, label: 'Solo arrendamiento' }]} /></Field>
          </>)}
          {step === 3 && (<>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#4a4a4a' }}>Documentos requeridos</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#9ca3af' }}>Suba una foto clara o PDF de cada documento. Todos son obligatorios.</p>
            {errors.global && <div style={{ background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#b91c3c', fontSize: 14, marginBottom: 16, fontWeight: 600 }}>{errors.global}</div>}
            <FileBox field="doc_identificacion" label="Identificación oficial (INE/Pasaporte)" hint="Toca para subir identificación" fileRef={fileRef1} />
            <FileBox field="doc_comprobante_domicilio" label="Comprobante de domicilio del inmueble (reciente)" hint="Toca para subir comprobante" fileRef={fileRef2} />
            <FileBox field="doc_predial" label="Última boleta de predial (año en curso)" hint="Toca para subir predial" fileRef={fileRef3} />
            <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.6, marginTop: 20, padding: '14px', background: '#f8f8f8', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              🔒 Al enviar este formulario, acepta nuestro{' '}<a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: '#b91c3c' }}>Aviso de Privacidad</a>. Su información es confidencial.
            </div>
          </>)}
          {step === 4 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fff0f3', color: '#b91c3c', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>✓</div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: '#4a4a4a', margin: '0 0 12px' }}>¡Registro enviado!</h2>
              <p style={{ color: '#9ca3af', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>Recibimos los datos de su inmueble. En breve nos pondremos en contacto para confirmar los detalles y comenzar la promoción.</p>
              {submitId && <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 20 }}>Folio: <strong style={{ color: '#b91c3c' }}>{submitId.slice(0, 8).toUpperCase()}</strong></p>}
              <div style={{ padding: '16px 20px', background: '#f8f8f8', border: '1px solid #e5e7eb', borderRadius: 10, textAlign: 'left' }}>
                <p style={{ margin: 0, fontWeight: 700, color: '#374151', fontSize: 14 }}>¿Tiene alguna duda?</p>
                <p style={{ margin: '6px 0 0', color: '#9ca3af', fontSize: 13 }}>Llámenos al <strong style={{ color: '#b91c3c' }}>222 257 3237</strong></p>
              </div>
            </div>
          )}
          {step < 4 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
              {step > 1 && (<button onClick={() => setStep(s => s - 1)} disabled={loading} style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>← Anterior</button>)}
              <button onClick={next} disabled={loading} style={{ padding: '12px 28px', borderRadius: 8, border: 'none', background: '#b91c3c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Enviando...' : step === 3 ? 'Enviar registro' : 'Siguiente →'}
              </button>
            </div>
          )}
          </div>
        </div>
        <footer style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 20 }}>© {new Date().getFullYear()} Emporio Inmobiliario · Puebla, México</footer>
      </div>
    </>
  )
}
