import { useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

// ─── Estilos ──────────────────────────────────────────────
const styles = {
  page: { minHeight: '100vh', background: '#0F0F0F', fontFamily: "'DM Sans', sans-serif", color: '#E8E8E8', paddingBottom: 60 },
  header: { display: 'flex', justifyContent: 'center', padding: '28px 20px 0' },
  logo: { height: 48, objectFit: 'contain' },
  hero: { textAlign: 'center', padding: '32px 20px 16px' },
  heroTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 700, color: '#FFFFFF', margin: '0 0 8px' },
  heroSub: { color: '#888', fontSize: 15, margin: 0 },
  progress: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' },
  progressStep: { display: 'flex', alignItems: 'center', gap: 8 },
  progressDot: { width: 32, height: 32, borderRadius: '50%', background: '#222', border: '2px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#555', flexShrink: 0 },
  progressDotActive: { background: '#C8973A', border: '2px solid #C8973A', color: '#000' },
  progressDotDone: { background: '#2A5C3F', border: '2px solid #2A5C3F', color: '#5EC98A' },
  progressLabel: { fontSize: 12, color: '#555', display: 'none' },
  progressLabelActive: { color: '#C8973A', display: 'block' },
  progressLine: { width: 40, height: 2, background: '#222', margin: '0 8px' },
  progressLineDone: { background: '#2A5C3F' },
  card: { maxWidth: 560, margin: '0 auto', background: '#161616', border: '1px solid #222', borderRadius: 16, padding: '32px 28px', marginLeft: 16, marginRight: 16 },
  stepTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 700, color: '#FFF', margin: '0 0 6px' },
  stepDesc: { color: '#777', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 },
  subTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 600, color: '#C8973A', margin: '0 0 16px' },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#AAA', marginBottom: 8 },
  input: { width: '100%', background: '#1E1E1E', border: '1px solid #2E2E2E', borderRadius: 8, padding: '12px 14px', color: '#E8E8E8', fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: "'DM Sans', sans-serif" },
  inputError: { borderColor: '#8B3A3A' },
  prefix: { position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#666', fontSize: 15 },
  radioBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid #2E2E2E', background: '#1E1E1E', color: '#888', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  radioBtnActive: { background: '#C8973A20', border: '1px solid #C8973A', color: '#C8973A' },
  fileBox: { border: '2px dashed #2E2E2E', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: '#1A1A1A' },
  fileBoxDone: { border: '2px dashed #2A5C3F', background: '#1A2E20' },
  fileBoxError: { border: '2px dashed #8B3A3A' },
  fileIcon: { display: 'block', fontSize: 24, marginBottom: 8, color: '#C8973A' },
  fileLabel: { display: 'block', fontSize: 14, color: '#DDD', fontWeight: 500, marginBottom: 4 },
  fileHint: { display: 'block', fontSize: 12, color: '#555' },
  divider: { height: 1, background: '#222', margin: '28px 0' },
  errorMsg: { color: '#E07070', fontSize: 12, margin: '6px 0 0' },
  globalError: { background: '#2A1A1A', border: '1px solid #8B3A3A', borderRadius: 8, padding: '12px 16px', color: '#E07070', fontSize: 14, marginBottom: 16 },
  privacyNote: { fontSize: 12, color: '#555', lineHeight: 1.6, marginTop: 20, padding: '14px', background: '#111', borderRadius: 8, border: '1px solid #1E1E1E' },
  btnRow: { display: 'flex', gap: 12, marginTop: 32, justifyContent: 'flex-end' },
  btnBack: { padding: '13px 22px', borderRadius: 8, border: '1px solid #2E2E2E', background: 'transparent', color: '#888', fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnNext: { padding: '13px 28px', borderRadius: 8, border: 'none', background: '#C8973A', color: '#000', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  successWrap: { textAlign: 'center', padding: '20px 0' },
  successIcon: { width: 64, height: 64, borderRadius: '50%', background: '#2A5C3F', color: '#5EC98A', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' },
  successTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontWeight: 700, color: '#FFF', margin: '0 0 12px' },
  successDesc: { color: '#888', fontSize: 15, lineHeight: 1.6, maxWidth: 380, margin: '0 auto' },
  contactBox: { marginTop: 28, padding: '16px 20px', background: '#1A1A1A', border: '1px solid #222', borderRadius: 10, textAlign: 'left' },
  footer: { textAlign: 'center', color: '#333', fontSize: 12, marginTop: 40 },
}

// ─── Componentes auxiliares — FUERA del componente principal ──
// Esto es crítico: si se definen adentro, React los destruye en cada render

const Field = ({ label, error, children, required }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={styles.label}>
      {label}{required && <span style={{ color: '#C8973A' }}> *</span>}
    </label>
    {children}
    {error && <p style={styles.errorMsg}>{error}</p>}
  </div>
)

const RadioGroup = ({ value, onChange, options }) => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    {options.map(o => (
      <button
        key={String(o.value)}
        type="button"
        onClick={() => onChange(o.value)}
        style={{ ...styles.radioBtn, ...(String(value) === String(o.value) ? styles.radioBtnActive : {}) }}
      >
        {o.label}
      </button>
    ))}
  </div>
)

// ─── Componente principal ──────────────────────────────────
export default function RegistroPropietario() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitId, setSubmitId] = useState(null)

  // Solo campos que controlan UI condicional van en state
  const [formaPago, setFormaPago] = useState('transferencia')
  const [tipoInmueble, setTipoInmueble] = useState('habitacional_sin_muebles')
  const [mantenimientoIncluido, setMantenimientoIncluido] = useState(false)
  const [mascotasPermitidas, setMascotasPermitidas] = useState('no')
  const [reglamento, setReglamento] = useState('no')
  const [contratoAdmin, setContratoAdmin] = useState(false)

  const [files, setFiles] = useState({
    doc_identificacion: null,
    doc_comprobante_domicilio: null,
    doc_predial: null,
  })

  // Un solo ref apunta al card — todos los inputs viven adentro
  const formRef = useRef(null)
  const fileRef1 = useRef()
  const fileRef2 = useRef()
  const fileRef3 = useRef()
  const fileRefs = { doc_identificacion: fileRef1, doc_comprobante_domicilio: fileRef2, doc_predial: fileRef3 }

  // Leer todos los inputs por name al momento de validar/guardar
  const getValues = () => {
    const data = {}
    if (!formRef.current) return data
    formRef.current.querySelectorAll('input[name], textarea[name]').forEach(el => {
      data[el.name] = el.value
    })
    return data
  }

  const handleFile = (field, file) => {
    setFiles(f => ({ ...f, [field]: file }))
    setErrors(e => ({ ...e, [field]: undefined }))
  }

  const validateStep1 = () => {
    const v = getValues()
    const e = {}
    if (!v.nombre_propietario?.trim()) e.nombre_propietario = 'Requerido'
    if (!v.telefono_propietario?.trim()) e.telefono_propietario = 'Requerido'
    if (!v.correo_propietario?.trim()) e.correo_propietario = 'Requerido'
    if (!v.domicilio_propietario?.trim()) e.domicilio_propietario = 'Requerido'
    if (formaPago === 'transferencia' && !v.clabe?.trim()) e.clabe = 'Requerido para transferencia'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const v = getValues()
    const e = {}
    if (!v.direccion_inmueble?.trim()) e.direccion_inmueble = 'Requerido'
    if (!v.monto_renta) e.monto_renta = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep3 = () => {
    const e = {}
    if (!files.doc_identificacion) e.doc_identificacion = 'Sube tu identificación oficial'
    if (!files.doc_comprobante_domicilio) e.doc_comprobante_domicilio = 'Sube comprobante de domicilio'
    if (!files.doc_predial) e.doc_predial = 'Sube la boleta de predial'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    if (step === 3) { handleSubmit(); return }
    setStep(s => s + 1)
  }

  const uploadFile = async (field, file, id) => {
    const ext = file.name.split('.').pop()
    const path = `propietarios/${id}/${field}.${ext}`
    const { error } = await supabase.storage.from('poliza-docs').upload(path, file, { upsert: true })
    if (error) throw error
    return path
  }

  const handleSubmit = async () => {
    if (!validateStep3()) return
    setLoading(true)
    try {
      const v = getValues()
      const payload = {
        nombre_propietario: v.nombre_propietario,
        telefono_propietario: v.telefono_propietario,
        correo_propietario: v.correo_propietario,
        domicilio_propietario: v.domicilio_propietario,
        rfc_propietario: v.rfc_propietario,
        clave_elector_propietario: v.clave_elector_propietario,
        forma_pago: formaPago,
        banco: v.banco,
        clabe: v.clabe,
        cuenta_bancaria: v.cuenta_bancaria,
        direccion_inmueble: v.direccion_inmueble,
        tipo_inmueble: tipoInmueble,
        monto_renta: parseFloat(v.monto_renta) || null,
        mantenimiento_incluido: mantenimientoIncluido,
        mascotas_permitidas: mascotasPermitidas,
        detalle_mascotas: v.detalle_mascotas,
        num_habitantes: parseInt(v.num_habitantes) || null,
        reglamento,
        permiso_mudanzas: v.permiso_mudanzas,
        contrato_administracion: contratoAdmin,
      }

      const { data, error } = await supabase
        .from('propietarios_inmuebles')
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error

      const id = data.id
      const urls = {}
      for (const field of Object.keys(files)) {
        if (files[field]) urls[field] = await uploadFile(field, files[field], id)
      }
      if (Object.keys(urls).length > 0) {
        await supabase.from('propietarios_inmuebles').update(urls).eq('id', id)
      }

      setSubmitId(id)
      setStep(4)
    } catch (err) {
      console.error(err)
      setErrors({ global: 'Ocurrió un error. Por favor intenta de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  const STEPS = [{ id: 1, label: 'Sus datos' }, { id: 2, label: 'El inmueble' }, { id: 3, label: 'Documentos' }]

  return (
    <>
      <Head>
        <title>Registra tu inmueble — Emporio Inmobiliario</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>

      <div style={styles.page}>
        <header style={styles.header}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={styles.logo} />
        </header>

        {step < 4 && (
          <div style={styles.hero}>
            <h1 style={styles.heroTitle}>Registra tu inmueble</h1>
            <p style={styles.heroSub}>Completa el formulario y comenzamos a promocionarlo</p>
          </div>
        )}

        {step < 4 && (
          <div style={styles.progress}>
            {STEPS.map((s, i) => (
              <div key={s.id} style={styles.progressStep}>
                <div style={{ ...styles.progressDot, ...(step >= s.id ? styles.progressDotActive : {}), ...(step > s.id ? styles.progressDotDone : {}) }}>
                  {step > s.id ? '✓' : s.id}
                </div>
                <span style={{ ...styles.progressLabel, ...(step === s.id ? styles.progressLabelActive : {}) }}>{s.label}</span>
                {i < 2 && <div style={{ ...styles.progressLine, ...(step > s.id ? styles.progressLineDone : {}) }} />}
              </div>
            ))}
          </div>
        )}

        {/* El ref va en el card — persiste entre pasos */}
        <div style={styles.card} ref={formRef}>

          {/* PASO 1 */}
          {step === 1 && (
            <>
              <h2 style={styles.stepTitle}>Sus datos personales</h2>
              <p style={styles.stepDesc}>Esta información aparecerá en su contrato de prestación de servicios.</p>

              <Field label="Nombre completo" required error={errors.nombre_propietario}>
                <input name="nombre_propietario" type="text" placeholder="Como aparece en su identificación oficial"
                  style={{ ...styles.input, ...(errors.nombre_propietario ? styles.inputError : {}) }} />
              </Field>
              <Field label="Teléfono de contacto" required error={errors.telefono_propietario}>
                <input name="telefono_propietario" type="tel" placeholder="10 dígitos"
                  style={{ ...styles.input, ...(errors.telefono_propietario ? styles.inputError : {}) }} />
              </Field>
              <Field label="Correo electrónico" required error={errors.correo_propietario}>
                <input name="correo_propietario" type="email" placeholder="correo@ejemplo.com"
                  style={{ ...styles.input, ...(errors.correo_propietario ? styles.inputError : {}) }} />
              </Field>
              <Field label="Domicilio particular" required error={errors.domicilio_propietario}>
                <textarea name="domicilio_propietario" placeholder="Calle, número, colonia, ciudad, estado" rows={3}
                  style={{ ...styles.input, resize: 'vertical', ...(errors.domicilio_propietario ? styles.inputError : {}) }} />
              </Field>
              <Field label="RFC">
                <input name="rfc_propietario" type="text" placeholder="XXXX000000XXX" style={styles.input} />
              </Field>
              <Field label="Clave de elector (INE)">
                <input name="clave_elector_propietario" type="text" placeholder="Clave de elector" style={styles.input} />
              </Field>

              <div style={styles.divider} />
              <h3 style={styles.subTitle}>Datos para recibir su renta</h3>

              <Field label="Forma de pago preferida">
                <RadioGroup value={formaPago} onChange={setFormaPago} options={[
                  { value: 'transferencia', label: 'Transferencia bancaria' },
                  { value: 'efectivo', label: 'Efectivo' },
                ]} />
              </Field>

              {formaPago === 'transferencia' && (
                <>
                  <Field label="Banco">
                    <input name="banco" type="text" placeholder="Ej: BBVA, Banorte, HSBC..." style={styles.input} />
                  </Field>
                  <Field label="CLABE interbancaria" required error={errors.clabe}>
                    <input name="clabe" type="text" placeholder="18 dígitos" maxLength={18}
                      style={{ ...styles.input, ...(errors.clabe ? styles.inputError : {}) }} />
                  </Field>
                  <Field label="Número de cuenta">
                    <input name="cuenta_bancaria" type="text" placeholder="Opcional" style={styles.input} />
                  </Field>
                </>
              )}
            </>
          )}

          {/* PASO 2 */}
          {step === 2 && (
            <>
              <h2 style={styles.stepTitle}>Datos del inmueble</h2>
              <p style={styles.stepDesc}>Con esta información promocionaremos su propiedad.</p>

              <Field label="Dirección del inmueble" required error={errors.direccion_inmueble}>
                <textarea name="direccion_inmueble" placeholder="Calle, número, colonia, municipio, estado" rows={3}
                  style={{ ...styles.input, resize: 'vertical', ...(errors.direccion_inmueble ? styles.inputError : {}) }} />
              </Field>

              <Field label="Tipo de inmueble">
                <RadioGroup value={tipoInmueble} onChange={setTipoInmueble} options={[
                  { value: 'habitacional_sin_muebles', label: 'Casa/Depto sin muebles' },
                  { value: 'habitacional_amueblada', label: 'Casa/Depto amueblada' },
                  { value: 'comercial', label: 'Local comercial' },
                ]} />
              </Field>

              <Field label="Monto de renta mensual (MXN)" required error={errors.monto_renta}>
                <div style={{ position: 'relative' }}>
                  <span style={styles.prefix}>$</span>
                  <input name="monto_renta" type="number" placeholder="0.00"
                    style={{ ...styles.input, paddingLeft: 32, ...(errors.monto_renta ? styles.inputError : {}) }} />
                </div>
              </Field>

              <Field label="¿El mantenimiento está incluido en la renta?">
                <RadioGroup value={mantenimientoIncluido} onChange={setMantenimientoIncluido} options={[
                  { value: true, label: 'Sí, incluido' },
                  { value: false, label: 'No incluido' },
                ]} />
              </Field>

              <Field label="¿Se permiten mascotas?">
                <RadioGroup value={mascotasPermitidas} onChange={setMascotasPermitidas} options={[
                  { value: 'si', label: 'Sí' },
                  { value: 'no', label: 'No' },
                  { value: 'condicionado', label: 'Condicionado' },
                ]} />
              </Field>
              {(mascotasPermitidas === 'si' || mascotasPermitidas === 'condicionado') && (
                <Field label="Especifique condiciones de mascotas">
                  <input name="detalle_mascotas" type="text" placeholder="Ej: Solo perros pequeños, sin gatos, etc." style={styles.input} />
                </Field>
              )}

              <Field label="Número máximo de habitantes">
                <input name="num_habitantes" type="number" placeholder="Ej: 4" style={styles.input} />
              </Field>

              <Field label="¿Cuenta con reglamento de vecinos?">
                <RadioGroup value={reglamento} onChange={setReglamento} options={[
                  { value: 'si', label: 'Sí' },
                  { value: 'no', label: 'No' },
                ]} />
              </Field>

              <Field label="Condiciones para mudanza">
                <input name="permiso_mudanzas" type="text" placeholder="Ej: Solo sábados 9am-5pm, avisar con 48 hrs..." style={styles.input} />
              </Field>

              <div style={styles.divider} />
              <h3 style={styles.subTitle}>Servicio de administración</h3>
              <p style={{ ...styles.stepDesc, marginBottom: 12 }}>
                ¿Desea que Emporio administre su inmueble? (cobranza, mantenimiento, reportes mensuales)
              </p>
              <Field label="¿Contratar servicio de administración?">
                <RadioGroup value={contratoAdmin} onChange={setContratoAdmin} options={[
                  { value: true, label: 'Sí, me interesa' },
                  { value: false, label: 'Solo arrendamiento' },
                ]} />
              </Field>
            </>
          )}

          {/* PASO 3 */}
          {step === 3 && (
            <>
              <h2 style={styles.stepTitle}>Documentos requeridos</h2>
              <p style={styles.stepDesc}>Suba una foto clara o PDF de cada documento. Todos son obligatorios.</p>

              {[
                { field: 'doc_identificacion', label: 'Identificación oficial (INE/Pasaporte)', hint: 'Toca para subir identificación', ref: fileRef1 },
                { field: 'doc_comprobante_domicilio', label: 'Comprobante de domicilio del inmueble (reciente)', hint: 'Toca para subir comprobante', ref: fileRef2 },
                { field: 'doc_predial', label: 'Última boleta de predial (año en curso)', hint: 'Toca para subir predial', ref: fileRef3 },
              ].map(({ field, label, hint, ref }) => (
                <Field key={field} label={label} error={errors[field]}>
                  <div
                    onClick={() => ref.current.click()}
                    style={{ ...styles.fileBox, ...(files[field] ? styles.fileBoxDone : {}), ...(errors[field] ? styles.fileBoxError : {}) }}
                  >
                    <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={e => handleFile(field, e.target.files[0])} />
                    <span style={styles.fileIcon}>{files[field] ? '✓' : '↑'}</span>
                    <span style={styles.fileLabel}>{files[field] ? files[field].name : hint}</span>
                    <span style={styles.fileHint}>{files[field] ? 'Toca para cambiar' : 'PDF, JPG o PNG · máx 10 MB'}</span>
                  </div>
                </Field>
              ))}

              {errors.global && <div style={styles.globalError}>{errors.global}</div>}

              <div style={styles.privacyNote}>
                🔒 Al enviar este formulario, acepta nuestro{' '}
                <a href="https://emporio-inmobiliario.easybroker.com/AVISO" target="_blank" rel="noreferrer" style={{ color: '#C8973A' }}>
                  Aviso de Privacidad
                </a>. Su información es confidencial.
              </div>
            </>
          )}

          {/* PASO 4 */}
          {step === 4 && (
            <div style={styles.successWrap}>
              <div style={styles.successIcon}>✓</div>
              <h2 style={styles.successTitle}>¡Registro enviado!</h2>
              <p style={styles.successDesc}>
                Recibimos los datos de su inmueble. En breve nos pondremos en contacto para confirmar los detalles y comenzar la promoción.
              </p>
              {submitId && (
                <p style={{ color: '#888', fontSize: 13, marginTop: 16 }}>
                  Folio: <strong style={{ color: '#C8973A' }}>{submitId.slice(0, 8).toUpperCase()}</strong>
                </p>
              )}
              <div style={styles.contactBox}>
                <p style={{ margin: 0, fontWeight: 600, color: '#fff' }}>¿Tiene alguna duda?</p>
                <p style={{ margin: '6px 0 0', color: '#aaa', fontSize: 14 }}>
                  Llámenos al <strong style={{ color: '#C8973A' }}>222 257 3237</strong>
                </p>
              </div>
            </div>
          )}

          {/* Botones */}
          {step < 4 && (
            <div style={styles.btnRow}>
              {step > 1 && (
                <button onClick={() => setStep(s => s - 1)} style={styles.btnBack} disabled={loading}>
                  ← Anterior
                </button>
              )}
              <button onClick={next} style={{ ...styles.btnNext, ...(loading ? styles.btnDisabled : {}) }} disabled={loading}>
                {loading ? 'Enviando...' : step === 3 ? 'Enviar registro' : 'Siguiente →'}
              </button>
            </div>
          )}
        </div>

        <footer style={styles.footer}>
          © {new Date().getFullYear()} Emporio Inmobiliario · Puebla, México
        </footer>
      </div>
    </>
  )
}
